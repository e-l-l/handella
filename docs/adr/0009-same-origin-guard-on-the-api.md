# Refuse API requests that did not come from the dashboard

ADR 0001 has the built application and its API sharing one loopback origin,
which removed the need for CORS configuration. The absence of that
configuration was read as the absence of the problem, and it is not: no CORS
headers means another site cannot _read_ Handella's answers, and nothing at all
about whether its requests arrive. A cross-origin request that carries no body
and no custom headers is a simple request, sent with no preflight, and its
effect lands whether or not the page that sent it is ever allowed to see the
result.

Until the folder picker, every route that changed anything needed a JSON body,
and `Content-Type: application/json` forces a preflight that fails without CORS
headers. That protection was incidental rather than designed, and
`POST /api/repositories/choose-path` takes no body at all, so any page the
Handler visits could have opened a Finder dialog on their machine, repeatedly.
The method was not the defence its route comment claimed: POST stops a link and
a prefetch, not a script.

A CSRF token was the obvious alternative and buys nothing here. It would have to
be minted by the service, delivered to the page and stored, and it defends
against exactly what `Sec-Fetch-Site` already reports — with the difference that
the header is written by the browser and cannot be set from script, so there is
no secret to leak, rotate or forget. A CORS plugin was the other, and it answers
a different question: it decides what a caller may read, not what the service
may be made to do.

So an `onRequest` hook refuses any `/api` request whose `Sec-Fetch-Site` is
present and is neither `same-origin` nor `none`. Absent covers the Vite dev
proxy and the tests, neither of which is a browser; `none` is the Handler typing
the URL. Only `/api` is guarded, so a link to the dashboard from anywhere still
opens it, and `same-site` is refused along with `cross-site` because a sibling
port on loopback is not Handella.

This is worth having even though the service binds to 127.0.0.1 and one person
uses it. Loopback is a boundary against the network and not against the browser
already running on the machine, which is the one caller that can reach it.
