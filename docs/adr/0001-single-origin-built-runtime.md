# Serve the built application from one origin

During development, Vite and Fastify run as separate processes with `/api` proxied to Fastify for fast feedback. The built application is served by Fastify from the same loopback origin as its API, avoiding production CORS configuration and keeping future server-sent events on a simple same-origin connection.
