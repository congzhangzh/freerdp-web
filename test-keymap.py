# Prints the keys the X server holds down (XQueryKeymap); with --size also the screen size, with
# --pointer the pointer position. test-meta.mjs, test-fs-connect.mjs and test-capture.mjs run it in the xrdp container.
import ctypes, ctypes.util, sys
x = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11") or "libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XDefaultRootWindow.restype = ctypes.c_ulong
d = x.XOpenDisplay(sys.argv[1].encode())
if not d: print("cannot open display"); sys.exit(1)
buf = (ctypes.c_char * 32)()
x.XQueryKeymap(ctypes.c_void_p(d), buf)
down = [i * 8 + b for i, byte in enumerate(buf.raw) for b in range(8) if byte >> b & 1]
x.XKeysymToString.restype = ctypes.c_char_p
x.XKeycodeToKeysym.restype = ctypes.c_ulong
names = [(k, (x.XKeysymToString(x.XKeycodeToKeysym(ctypes.c_void_p(d), k, 0)) or b"?").decode()) for k in down]
print("down:", names)
if len(sys.argv) > 2 and sys.argv[2] == "--size":
    print("screen:", x.XDisplayWidth(ctypes.c_void_p(d), 0), "x", x.XDisplayHeight(ctypes.c_void_p(d), 0))
if len(sys.argv) > 2 and sys.argv[2] == "--pointer":
    root = x.XDefaultRootWindow(ctypes.c_void_p(d))
    w, c = ctypes.c_ulong(), ctypes.c_ulong()
    rx, ry, wx, wy, m = (ctypes.c_int() for _ in range(5))
    x.XQueryPointer(ctypes.c_void_p(d), ctypes.c_ulong(root), ctypes.byref(w), ctypes.byref(c),
                    ctypes.byref(rx), ctypes.byref(ry), ctypes.byref(wx), ctypes.byref(wy), ctypes.byref(m))
    print("pointer:", rx.value, ry.value)
