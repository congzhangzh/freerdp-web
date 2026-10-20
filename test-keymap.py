# Prints the keys the X server holds down (XQueryKeymap); test-meta.mjs runs it in the xrdp container.
import ctypes, ctypes.util, sys
x = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11") or "libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
d = x.XOpenDisplay(sys.argv[1].encode())
if not d: print("cannot open display"); sys.exit(1)
buf = (ctypes.c_char * 32)()
x.XQueryKeymap(ctypes.c_void_p(d), buf)
down = [i * 8 + b for i, byte in enumerate(buf.raw) for b in range(8) if byte >> b & 1]
x.XKeysymToString.restype = ctypes.c_char_p
x.XKeycodeToKeysym.restype = ctypes.c_ulong
names = [(k, (x.XKeysymToString(x.XKeycodeToKeysym(ctypes.c_void_p(d), k, 0)) or b"?").decode()) for k in down]
print("down:", names)
