#!/bin/bash
# Build FreeRDP codec/primitives unit tests with Emscripten (Node target) and run
# them, to tell wasm-specific decoder bugs from bad input streams.
# Reuses the deps prefix from build-wasm.sh. Usage: ./build-wasm-tests.sh [TestName...]
set -euo pipefail
SRC=$(realpath "$FREERDP_SRC")
HERE=$(cd "$(dirname "$0")" && pwd)
GITDIR=$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)
TESTS=${*:-TestFreeRDPCodecAV1 TestFreeRDPCodecRemoteFX TestFreeRDPCodecClear TestFreeRDPCodecPlanar}
# WEB=1: build the runner for the browser instead (dist-test/, run by test-codec.mjs in Chrome)
docker run --rm -i -u "$(id -u):$(id -g)" -e SRC="$SRC" -e HOME=/tmp -e TESTS="$TESTS" -e WEB="${WEB:-}" \
  -v "$SRC":"$SRC" -v "$GITDIR":"$GITDIR" -v "$HERE":/w -w /w/cache emscripten/emsdk:latest bash -s <<'IN'
set -euo pipefail
P=/w/cache/prefix; B=build/freerdp-tests
LINK="-pthread -sPROXY_TO_PTHREAD -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=4194304 -sPTHREAD_POOL_SIZE=8 -sEXIT_RUNTIME=1 -sENVIRONMENT=node -sNODERAWFS=1"
if [ -n "$WEB" ]; then
  B=build/freerdp-tests-web
  LINK="-pthread -sPROXY_TO_PTHREAD -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sSTACK_SIZE=4194304 -sPTHREAD_POOL_SIZE=8 -sEXIT_RUNTIME=1 -sENVIRONMENT=web,worker -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=callMain"
fi
export CFLAGS="-pthread -O2" CXXFLAGS="-pthread -O2"
# libaom (encoder for the AV1 round-trip test only; static, the client build has WITH_AOM=OFF)
if [ ! -f $P/lib/libaom.a ]; then
  [ -d src/aom ] || git -c advice.detachedHead=false clone -q --depth 1 -b v3.12.1 https://aomedia.googlesource.com/aom src/aom
  emcmake cmake -G "Unix Makefiles" -S src/aom -B build/aom -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P \
    -DAOM_TARGET_CPU=generic -DBUILD_SHARED_LIBS=0 -DENABLE_TESTS=0 -DENABLE_EXAMPLES=0 -DENABLE_TOOLS=0 -DENABLE_DOCS=0 \
    > /w/out/build-aom.log 2>&1 && cmake --build build/aom --parallel >> /w/out/build-aom.log 2>&1 \
    && cmake --install build/aom >> /w/out/build-aom.log 2>&1 || { tail -30 /w/out/build-aom.log; exit 1; }
fi
emcmake cmake -G "Unix Makefiles" -S $SRC -B $B -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH=$P -DCMAKE_FIND_ROOT_PATH=$P -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_TESTING=OFF -DBUILD_TESTING_INTERNAL=ON -DBUILD_TESTING_NO_H264=ON \
  -DWITH_CLIENT=OFF -DWITH_SERVER=OFF -DWITH_SAMPLE=OFF -DWITH_SHADOW=OFF -DWITH_PROXY=OFF \
  -DWITH_X11=OFF -DWITH_WAYLAND=OFF -DWITH_ALSA=OFF -DWITH_PULSE=OFF -DWITH_OSS=OFF -DWITH_CUPS=OFF \
  -DWITH_PCSC=OFF -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_OPENH264=OFF -DWITH_KRB5=OFF -DWITH_FUSE=OFF -DWITH_CHANNELS=OFF -DCHANNEL_URBDRC=OFF \
  -DWITH_SIMD=OFF -DWITH_MANPAGES=OFF -DWITH_OPUS=OFF -DWITH_FDK_AAC=OFF -DWITH_UNICODE_BUILTIN=ON \
  -DWITH_GFX_AV1=ON -DWITH_DAV1D=ON -DWITH_AOM=ON \
  -DUSE_UNWIND=OFF -DWITH_JSONC_REQUIRED=ON -DWITHOUT_FREERDP_3x_DEPRECATED=ON -DWITHOUT_WINPR_3x_DEPRECATED=ON \
  -DCMAKE_EXE_LINKER_FLAGS="$LINK" \
  > /w/out/build-tests.log 2>&1 || { tail -30 /w/out/build-tests.log; exit 1; }
cmake --build $B --parallel --target TestFreeRDPCodec >> /w/out/build-tests.log 2>&1 || { grep -E 'error' /w/out/build-tests.log | sort | uniq -c | head -20; exit 1; }
T=$(find $B -name 'TestFreeRDPCodec.js' | head -1); echo "runner: $T"
if [ -n "$WEB" ]; then
  mkdir -p /w/dist-test && cp "$(dirname "$T")"/TestFreeRDPCodec.js "$(dirname "$T")"/TestFreeRDPCodec.wasm /w/dist-test/
  cp /w/test-codec.html /w/dist-test/index.html && ls -la /w/dist-test && exit 0
fi
cd "$(dirname "$T")"
for t in $TESTS; do
  s=$(date +%s.%N); set +e; out=$(timeout 300 node TestFreeRDPCodec.js $t 2>&1); rc=$?; set -e
  printf "%-32s rc=%s\n" "$t" "$rc"
  [ $rc -ne 0 ] && echo "$out" | tail -15 | sed 's/^/    /'
  ! echo "$out" | grep -q -i 'skipping' || echo "    SKIPPED, not a pass: $(echo "$out" | grep -i -m1 skipping)"
  echo "$out" | grep -i -E 'colour difference|maximum' | head -2 | sed 's/^/    /' || true
done
IN
