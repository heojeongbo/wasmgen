# Runtime notices

`GO-LICENSE` comes from https://github.com/golang/go/blob/go1.22.0/LICENSE.
It is used only when an OS Go distribution omits `GOROOT/LICENSE`; otherwise
wasmgen copies the selected Go toolchain's license.

The following files are copied unchanged from Emscripten 4.0.10, the C++
toolchain tested by this project:

| File | Upstream path |
| --- | --- |
| EMSCRIPTEN-LICENSE | LICENSE |
| MUSL-COPYRIGHT | system/lib/libc/musl/COPYRIGHT |
| LIBCXX-LICENSE | system/lib/libcxx/LICENSE.TXT |
| LIBCXXABI-LICENSE | system/lib/libcxxabi/LICENSE.TXT |
| COMPILER-RT-LICENSE | system/lib/compiler-rt/LICENSE.TXT |

Source: https://github.com/emscripten-core/emscripten/tree/4.0.10

Generated modules carry these notices. Application distributors must also
include notices for their native sources and any additional dependencies,
and check notices when using another compiler version. Web bundlers do not
automatically copy these text files; preserve them with the deployed app's notices.
