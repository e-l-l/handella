# Keep a screen's own state in React context, not a store library

The Intake screen held its filters and its Selection in `useState`, so leaving
the screen destroyed both. The Selection is work the Handler did and Handella
never asked for twice, and the filters are worse than they look: resetting them
changes the query key, so returning to Intake asks the local service for a list
it already had, and that list costs a round trip to Linear per issue. The
obvious reading was that the dashboard has no client state layer and refetches
everything. It does have one — TanStack Query is the only fetching mechanism in
the application — but a query cache is for what the service owns, and nothing
owned the Handler's half.

Redux and Zustand were the alternatives considered, and the deciding question
was what the rest of the roadmap actually needs. Phases 8, 9 and 11 each add one
more editing buffer that must survive navigation: the imported feature plan, the
Slack issue preview, the accepted-or-disputed triage of a review round. Every
one of them is private to its own screen. Nothing shared between screens is
client state at all — Jobs, Attention Items, queue order and plan versions are
the service's, and the event stream plus the query cache already keep them
honest. So the shape being solved for is three or four independent buffers, not
one graph that many screens read and write, and that is the shape Redux exists
for. Its devtools and middleware would be bought with a slice per buffer and
nothing to show for it in a single-user local application.

Zustand was closer and was refused on a narrower point. Its store is a module
singleton, and `renderApp.tsx` currently builds a fresh `QueryClient` per
render, so every suite gets isolation without asking. A singleton would make
state bleed between tests the default and a reset in `afterEach` the thing
someone has to remember — a standing obligation traded for provider boilerplate
written once.

URL search parameters looked like the answer that needed no store, and they are
not: the navigation is `<NavLink to="/intake">`, which resolves to a bare
`/intake`, so the parameters are dropped on the way out. Keeping them would mean
something remembering them across the trip, which is the store again.

The state is therefore held in context above the router, in memory. A reload
loses it, which is correct: reloading is not part of supervising Handella, and
persisting it would buy a serialised shape to keep versioned against
`IntakeChoices` for a case that does not arise. Backing it with storage later is
a change inside the provider that no consumer would see. The provider is written
for Intake alone rather than as a general draft mechanism — Phase 9 is the
second real case, and it is the one that should say what the two have in common.
