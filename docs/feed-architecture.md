## Feed Architecture

The site has one feed system with multiple scopes.

### Canonical behavior

The public feed implementation in `pages/dashboard.tsx` is the source of truth for post feed behavior.

That means the dashboard defines:

- post card presentation
- solve vs solutions semantics
- attempt-rule interpretation
- share behavior
- thread/reply expectations

Other feed surfaces must conform to that contract instead of introducing their own post model.

### Feed scopes

The current post feed scopes are:

- `public`: all posts visible in the dashboard public feed
- `user-timeline`: posts visible on a specific user's timeline

The personal timeline is not a separate feed type. It is the `user-timeline` scope where the subject user is the current viewer.

### Canonical post contract

`lib/feedContract.ts` defines the canonical post payload shared by feed scopes.

The public feed API and user timeline API must both return that same post shape.

### Current scope adapters

- `pages/api/posts/feed.ts`: public feed scope adapter
- `pages/api/profile/view/[id]/posts.ts`: user timeline scope adapter

Both adapters can vary their query/filtering logic, but must emit the same canonical feed post structure.