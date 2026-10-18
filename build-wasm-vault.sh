#!/usr/bin/env bash
# Rebuild against a separate FreeRDP worktree using cached, read-only WASM dependencies.
# Build output, compiler cache and logs stay beside this script.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(realpath "${1:?usage: $0 <FreeRDP source dir>  (with WASM_DEPS=<WASM dependency prefix>)}")
DEPS=$(realpath "${WASM_DEPS:?set WASM_DEPS to a prefix with the WASM builds of FreeRDP dependencies}")
mkdir -p "$HERE/cache-vault" "$HERE/out"
docker run --rm -i -u "$(id -u):$(id -g)" -e SRC="$SRC" -e HOME=/tmp \
  -e WASM_RECONFIGURE="${WASM_RECONFIGURE:-0}" -e CCACHE_DIR=/w/cache-vault/ccache -e CCACHE_BASEDIR="${CCACHE_BASEDIR:-$(dirname "$SRC")}" \
  -v "$SRC":"$SRC":ro -v "$DEPS":/w/cache/prefix:ro -v "$HERE":/w -w /w freerdp-wasm-vault-toolchain bash -s <<'BUILD'
set -euo pipefail
P=/w/cache/prefix
B=/w/cache-vault/build
export CFLAGS="-pthread -O2" CXXFLAGS="-pthread -O2" LDFLAGS="-pthread"
ccache -z
start=$SECONDS
if [ ! -f "$B/build.ninja" ] || [ "$WASM_RECONFIGURE" = 1 ]; then
emcmake cmake -G Ninja -S "$SRC" -B "$B" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF \
  -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
  -DCMAKE_PREFIX_PATH="$P" -DCMAKE_FIND_ROOT_PATH="$P" \
  -DCMAKE_INSTALL_PREFIX=/w/cache-vault/install \
  -DBUILD_SHARED_LIBS=OFF -DWITH_CLIENT_SDL=ON -DWITH_CLIENT_SDL3=ON -DWITH_CLIENT_SDL2=OFF \
  -DWITH_SDL_LINK_SHARED=OFF -DWITH_SDL_IMAGE_DIALOGS=OFF \
  -DWITH_SERVER=OFF -DWITH_SAMPLE=OFF -DWITH_SHADOW=OFF -DWITH_PROXY=OFF -DWITH_PLATFORM_SERVER=OFF \
  -DWITH_X11=OFF -DWITH_WAYLAND=OFF -DWITH_ALSA=OFF -DWITH_PULSE=OFF -DWITH_OSS=OFF -DWITH_CUPS=OFF \
  -DWITH_PCSC=OFF -DWITH_SMARTCARD_EMULATE=OFF -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF \
  -DWITH_OPENH264=OFF -DWITH_KRB5=OFF -DWITH_FUSE=OFF -DWITH_LIBSYSTEMD=OFF -DWITH_WEBVIEW=OFF \
  -DWITH_CHANNELS=ON -DCHANNEL_URBDRC=OFF -DCHANNEL_RDPECAM=OFF -DWITH_SIMD=OFF -DWITH_MANPAGES=OFF \
  -DWITH_OPUS=ON -DWITH_FDK_AAC=OFF -DWITH_UNICODE_BUILTIN=ON -DWITH_TIMEZONE_ICU=OFF \
  -DUSE_UNWIND=OFF -DWITH_JSONC_REQUIRED=ON -DWITH_GFX_AV1=ON -DWITH_DAV1D=ON -DWITH_AOM=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="-pthread -sASYNCIFY -sASYNCIFY_STACK_SIZE=131072 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=1048576 -sPTHREAD_POOL_SIZE=32 -sWEBSOCKET_SUBPROTOCOL=binary -sENVIRONMENT=web,worker -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV,ccall -sEXPORTED_FUNCTIONS=_main,_malloc,_free" \
  -DWITHOUT_FREERDP_3x_DEPRECATED=ON -DWITHOUT_WINPR_3x_DEPRECATED=ON \
  > /w/out/configure-vault.log 2>&1 || { tail -60 /w/out/configure-vault.log; exit 1; }
fi
cmake --build "$B" --target sdl3-freerdp > /w/out/build-vault.log 2>&1 || {
  tail -80 /w/out/build-vault.log; exit 1;
}
mkdir -p /w/dist
cp "$B/client/SDL/SDL3/sdl-freerdp.js" "$B/client/SDL/SDL3/sdl-freerdp.wasm" /w/dist/
echo "Build wall time: $((SECONDS-start)) seconds"
ccache -s
BUILD
git -C "$SRC" rev-parse HEAD > "$HERE/dist/SOURCE_COMMIT"
git -C "$SRC" diff --binary HEAD -- > "$HERE/dist/SOURCE_CHANGES.patch"
bash "$HERE/deploy-web.sh"
