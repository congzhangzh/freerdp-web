#!/bin/bash
# Build the FreeRDP SDL3 client for the browser (Emscripten, pthreads) inside the
# emscripten/emsdk container. Spike for an upstream contribution, see the ledger §5.5.
# Source: FreeRDP worktree (default $FREERDP_SRC, branch wasm-sdl-client).
# Deps (built once, cached in ./cache): zlib, OpenSSL, json-c, SDL3, SDL3_ttf.
# Logs: ./out/build-<stage>.log
set -euo pipefail
SRC=$(realpath "${1:-$FREERDP_SRC}")
HERE=$(cd "$(dirname "$0")" && pwd)
GITDIR=$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)
mkdir -p "$HERE/out" "$HERE/cache"
docker run --rm -i -u "$(id -u):$(id -g)" -e SRC="$SRC" -e HOME=/tmp -e SAN="${SAN:-}" \
  -v "$SRC":"$SRC" -v "$GITDIR":"$GITDIR" -v "$HERE":/w -w /w/cache emscripten/emsdk:latest bash -s <<'IN'
set -euo pipefail
P=/w/cache/prefix; mkdir -p $P src build
FLAGS="-pthread -O2"
export CFLAGS="$FLAGS" CXXFLAGS="$FLAGS" LDFLAGS="-pthread"
fetch() { [ -d src/$1 ] || git -c advice.detachedHead=false clone -q --depth 1 -b $2 $3 src/$1; }
cm() { # name, extra cmake args...
  local n=$1; shift
  [ -f build/$n/.done ] && return 0
  echo "== $n"
  emcmake cmake -G "Unix Makefiles" -S src/$n -B build/$n -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=$P -DCMAKE_PREFIX_PATH=$P -DCMAKE_FIND_ROOT_PATH=$P \
    -DBUILD_SHARED_LIBS=OFF "$@" > /w/out/build-$n.log 2>&1 \
  && cmake --build build/$n --parallel >> /w/out/build-$n.log 2>&1 \
  && cmake --install build/$n >> /w/out/build-$n.log 2>&1 \
  && touch build/$n/.done || { tail -30 /w/out/build-$n.log; exit 1; }
}

fetch zlib v1.3.1 https://github.com/madler/zlib.git
fetch json-c json-c-0.18-20240915 https://github.com/json-c/json-c.git
fetch SDL release-3.2.28 https://github.com/libsdl-org/SDL.git
fetch SDL_ttf release-3.2.2 https://github.com/libsdl-org/SDL_ttf.git
[ -d src/SDL_ttf/external/freetype/src ] || (cd src/SDL_ttf && ./external/download.sh > /dev/null 2>&1)

cm zlib -DZLIB_BUILD_EXAMPLES=OFF
rm -f $P/lib/libz.so*   # zlib always installs a shared lib too; wasm must link libz.a statically
cm json-c -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DBUILD_STATIC_LIBS=ON -DDISABLE_THREAD_LOCAL_STORAGE=ON
cm SDL -DSDL_TEST_LIBRARY=OFF -DSDL_TESTS=OFF -DSDL_PTHREADS=ON
cm SDL_ttf -DSDLTTF_VENDORED=ON -DSDLTTF_HARFBUZZ=ON -DSDLTTF_PLUTOSVG=OFF -DSDLTTF_SAMPLES=OFF

# libopus (audio: GRD sends Opus instead of 1.5 Mbit/s PCM)
fetch opus v1.6 https://gitlab.xiph.org/xiph/opus.git
cm opus -DOPUS_BUILD_PROGRAMS=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_DISABLE_INTRINSICS=ON

# dav1d (AV1 decoder): meson, C only (no asm for wasm), pthreads
if [ ! -f $P/lib/libdav1d.a ]; then
  echo "== dav1d"
  fetch dav1d 1.5.1 https://code.videolan.org/videolan/dav1d.git
  python3 -m pip install -q --user --break-system-packages meson ninja  # throwaway container: PEP 668 does not matter here > /w/out/build-dav1d.log 2>&1
  export PATH=/tmp/.local/bin:$PATH
  cat > /tmp/emscripten-meson.ini <<MESON
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
strip = 'emstrip'
[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
[built-in options]
c_args = ['-pthread', '-O2']
c_link_args = ['-pthread']
MESON
  meson setup --cross-file /tmp/emscripten-meson.ini -Dprefix=$P -Dlibdir=lib -Ddefault_library=static \
    -Dbuildtype=release -Denable_asm=false -Denable_tools=false -Denable_tests=false build/dav1d src/dav1d >> /w/out/build-dav1d.log 2>&1 \
    && ninja -C build/dav1d install >> /w/out/build-dav1d.log 2>&1 || { tail -30 /w/out/build-dav1d.log; exit 1; }
fi

if [ ! -f $P/lib/libssl.a ]; then
  echo "== openssl"
  [ -d src/openssl ] || { curl -sL https://github.com/openssl/openssl/releases/download/openssl-3.5.4/openssl-3.5.4.tar.gz | tar xz -C src && mv src/openssl-3.5.4 src/openssl; }
  (cd src/openssl && emconfigure ./Configure linux-generic32 no-asm no-shared no-dso no-engine \
     no-afalgeng no-ui-console no-tests no-docs --prefix=$P --libdir=lib \
     && sed -i 's|^CROSS_COMPILE=.*|CROSS_COMPILE=|' Makefile \
     && emmake make -j"$(nproc)" build_libs && emmake make install_dev) > /w/out/build-openssl.log 2>&1 \
     || { tail -30 /w/out/build-openssl.log; exit 1; }
fi

echo "== freerdp"
# SAN=1: UBSan variant in its own build dir and dist-ubsan/, deps unchanged
B=build/freerdp; DIST=/w/dist; SANF=""
if [ -n "$SAN" ]; then B=build/freerdp-ubsan; DIST=/w/dist-ubsan; SANF="-fsanitize=undefined -g"; export CFLAGS="$CFLAGS $SANF" CXXFLAGS="$CXXFLAGS $SANF"; fi
emcmake cmake -G "Unix Makefiles" -S $SRC -B $B -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=$P -DCMAKE_FIND_ROOT_PATH=$P -DCMAKE_INSTALL_PREFIX=/w/cache/freerdp-install \
  -DBUILD_SHARED_LIBS=OFF -DWITH_CLIENT_SDL=ON -DWITH_CLIENT_SDL3=ON -DWITH_CLIENT_SDL2=OFF \
  -DWITH_SDL_LINK_SHARED=OFF -DWITH_SDL_IMAGE_DIALOGS=OFF \
  -DWITH_SERVER=OFF -DWITH_SAMPLE=OFF -DWITH_SHADOW=OFF -DWITH_PROXY=OFF -DWITH_PLATFORM_SERVER=OFF \
  -DWITH_X11=OFF -DWITH_WAYLAND=OFF -DWITH_ALSA=OFF -DWITH_PULSE=OFF -DWITH_OSS=OFF -DWITH_CUPS=OFF \
  -DWITH_PCSC=OFF -DWITH_SMARTCARD_EMULATE=OFF -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF \
  -DWITH_OPENH264=OFF -DWITH_KRB5=OFF -DWITH_FUSE=OFF -DWITH_LIBSYSTEMD=OFF -DWITH_WEBVIEW=OFF \
  -DWITH_CHANNELS=ON -DCHANNEL_URBDRC=OFF -DCHANNEL_RDPECAM=OFF -DWITH_SIMD=OFF -DWITH_MANPAGES=OFF \
  -DWITH_OPUS=ON -DWITH_FDK_AAC=OFF -DWITH_UNICODE_BUILTIN=ON -DWITH_TIMEZONE_ICU=OFF \
  -DUSE_UNWIND=OFF -DWITH_JSONC_REQUIRED=ON -DWITH_GFX_AV1=ON -DWITH_DAV1D=ON -DWITH_AOM=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="$SANF -pthread -sASYNCIFY -sASYNCIFY_STACK_SIZE=131072 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=1048576 -sPTHREAD_POOL_SIZE=32 -sWEBSOCKET_SUBPROTOCOL=binary -sENVIRONMENT=web,worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,ccall -sEXPORTED_FUNCTIONS=_main,_malloc,_free" \
  -DWITHOUT_FREERDP_3x_DEPRECATED=ON -DWITHOUT_WINPR_3x_DEPRECATED=ON \
  > /w/out/build-freerdp.log 2>&1 || { tail -40 /w/out/build-freerdp.log; exit 1; }
cmake --build $B --parallel -- -k >> /w/out/build-freerdp.log 2>&1 || {
  echo "freerdp build failed; distinct errors:"
  grep -E 'error:' /w/out/build-freerdp.log | sed -E 's/^.*\/FreeRDP\///' | sort | uniq -c | sort -rn | head -40
  exit 1; }
mkdir -p $DIST && cp $B/client/SDL/SDL3/sdl-freerdp.js $B/client/SDL/SDL3/sdl-freerdp.wasm $DIST/ && cp -r /w/web/. $DIST/ && ls -la $DIST
IN
