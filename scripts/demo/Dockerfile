FROM node:22-bookworm-slim AS node
FROM ghcr.io/charmbracelet/vhs:latest
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN printf '#!/bin/sh\nexec node /sable/dist/main.js "$@"\n' > /usr/local/bin/sable && chmod +x /usr/local/bin/sable
