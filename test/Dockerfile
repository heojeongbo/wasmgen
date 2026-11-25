FROM rust:1.100.0-slim-bookworm AS rust-tools
RUN rustup target add wasm32-unknown-unknown \
    && cargo install wasm-bindgen-cli --version 0.2.130 --locked
RUN rustup component add rustfmt

FROM mcr.microsoft.com/playwright:v1.60.0-noble

# Toolchains are needed by the generator, never by its generated browser client.
RUN apt-get update && apt-get install -y --no-install-recommends \
    golang-go build-essential ca-certificates git python3 xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 4.0.10 https://github.com/emscripten-core/emsdk.git /opt/emsdk \
    && /opt/emsdk/emsdk install 4.0.10 \
    && /opt/emsdk/emsdk activate 4.0.10
ENV PATH="/opt/emsdk/upstream/emscripten:${PATH}"
ENV EM_CONFIG=/opt/emsdk/.emscripten
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
COPY --from=rust-tools /usr/local/cargo /usr/local/cargo
COPY --from=rust-tools /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"
WORKDIR /work
