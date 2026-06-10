FROM nginx:1.27-alpine

RUN apk add --no-cache curl gettext

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint-register.sh /docker-entrypoint.d/99-register.sh
RUN chmod +x /docker-entrypoint.d/99-register.sh \
    && mkdir -p /var/cache/nginx/edge

EXPOSE 80
