FROM mcr.microsoft.com/playwright:v1.60.0-noble

# Toolchains are needed by the generator, never by its generated browser client.
RUN apt-get update && apt-get install -y --no-install-recommends \
    golang-go ca-certificates git python3 xz-utils \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 4.0.10 https://github.com/emscripten-core/emsdk.git /opt/emsdk \
    && /opt/emsdk/emsdk install 4.0.10 \
    && /opt/emsdk/emsdk activate 4.0.10
ENV PATH="/opt/emsdk/upstream/emscripten:${PATH}"
ENV EM_CONFIG=/opt/emsdk/.emscripten
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /work
