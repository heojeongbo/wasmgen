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

`RUST-LICENSE-MIT`, `RUST-LICENSE-APACHE`, and `RUST-COPYRIGHT` are copied
unchanged from Rust 1.100.0 (`LICENSE-MIT`, `LICENSE-APACHE`, `COPYRIGHT`):
https://github.com/rust-lang/rust/tree/1.100.0

`WASM-BINDGEN-LICENSE-MIT` and `WASM-BINDGEN-LICENSE-APACHE` are copied unchanged
from wasm-bindgen 0.2.130 (`LICENSE-MIT`, `LICENSE-APACHE`):
https://github.com/wasm-bindgen/wasm-bindgen/tree/0.2.130

The Rust adapter copies these tested-toolchain notices into generated modules.
Native Cargo dependencies may require additional notices; these files are not
a complete license inventory of arbitrary user crates.

Generated modules carry these notices. Application distributors must also
include notices for their native sources and any additional dependencies,
and check notices when using another compiler version. Web bundlers do not
automatically copy these text files; preserve them with the deployed app's notices.
