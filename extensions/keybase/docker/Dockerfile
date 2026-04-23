ARG OPENCLAW_BASE_IMAGE="openclaw:keybase-base-local"
FROM keybaseio/client:latest AS keybase-runtime

FROM ${OPENCLAW_BASE_IMAGE}

USER root

ARG TARGETARCH

RUN if [ "${TARGETARCH:-amd64}" != "amd64" ]; then \
      echo "Keybase smoke image currently supports linux/amd64 only." >&2; \
      exit 1; \
    fi

COPY --from=keybase-runtime /usr/bin/keybase /usr/bin/keybase
COPY --from=keybase-runtime /usr/bin/kbfsfuse /usr/bin/kbfsfuse
COPY --chown=node:node extensions/keybase /app/extensions/keybase

ENV KEYBASE_SERVICE=1

RUN chmod 755 /usr/bin/keybase /usr/bin/kbfsfuse && \
    install -d -o node -g node /home/node/.keybase

USER node
