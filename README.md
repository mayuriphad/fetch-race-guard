# fetch-race-guard 🛡️

> Zero-overhead race condition guard for async operations, search inputs, and API fetches. Automatically cancels stale requests and guarantees only the latest result updates your UI.

[![npm version](https://img.shields.io/npm/v/fetch-race-guard.svg)](https://www.npmjs.com/package/fetch-race-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)

---

### The Problem It Solves

Every frontend developer has shipped the classic **Async Search Race Condition**:

1. User types `"cat"` &rarr; **Request 1** fires (slow network, takes 800ms).
2. User quickly types `"caterpillar"` &rarr; **Request 2** fires (fast network, takes 200ms).
3. **Request 2** completes first and renders *caterpillar* results.
4. **Request 1** finishes late and **overwrites the screen with *cat* results!**

`fetch-race-guard` eliminates this problem completely. When a new call is made, any in-flight request is automatically aborted via `AbortController` and out-of-order stale responses are safely discarded.

---

### Installation

```bash
npm install fetch-race-guard
```
or with yarn / pnpm / bun:
```bash
bun add fetch-race-guard
pnpm add fetch-race-guard
```

---

### Quick Start

Wrap any async function with `createRaceGuard`:

```typescript
import { createRaceGuard } from 'fetch-race-guard';

const safeSearch = createRaceGuard(
  async (query: string, { signal }) => {
    // Pass the signal to fetch, axios, or any AbortSignal-compatible client
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
    return res.json();
  },
  // Superseded calls resolve to undefined instead of rejecting
  { onStale: 'silent' }
);

// Rapidly call it:
safeSearch('c');
safeSearch('cat');
const finalResults = await safeSearch('caterpillar');
// Guaranteed: only 'caterpillar' updates your UI!
```

With the default `onStale: 'reject'`, every superseded call rejects with a `StaleOperationError`. Catch it with `isAbortOrStaleError`, or calls you don't await end up as unhandled rejections:

```typescript
import { createRaceGuard, isAbortOrStaleError } from 'fetch-race-guard';

const strictSearch = createRaceGuard(searchFn); // onStale defaults to 'reject'
strictSearch('cat').catch((err) => {
  if (!isAbortOrStaleError(err)) throw err;
});
```

---

### Framework Examples

#### React (with `onSuccess`)

```tsx
import React, { useState, useMemo } from 'react';
import { createRaceGuard } from 'fetch-race-guard';

export function SearchComponent() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Wrap search in useMemo with race guard
  const performSearch = useMemo(
    () =>
      createRaceGuard(
        async (query: string, { signal }) => {
          const res = await fetch(`/api/users?search=${encodeURIComponent(query)}`, { signal });
          return res.json();
        },
        {
          onStale: 'silent', // Do not throw on superseded calls
          onSuccess: (data) => {
            setResults(data);
            setLoading(false);
          },
          onError: (err) => setLoading(false)
        }
      ),
    []
  );

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoading(true);
    performSearch(e.target.value);
  };

  return (
    <div>
      <input type="text" placeholder="Search users..." onChange={onChange} />
      {loading && <span>Loading...</span>}
      <ul>
        {results.map((u: any) => (
          <li key={u.id}>{u.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

#### Angular (Signals or Services)

```typescript
import { Component, signal } from '@angular/core';
import { createRaceGuard } from 'fetch-race-guard';

@Component({
  selector: 'app-user-search',
  template: `
    <input (input)="onSearch($event)" placeholder="Search..." />
    @for (user of users(); track user.id) {
      <div>{{ user.name }}</div>
    }
  `
})
export class UserSearchComponent {
  users = signal<any[]>([]);

  private searchGuard = createRaceGuard(
    async (term: string, { signal }) => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal });
      return res.json();
    },
    {
      onStale: 'silent',
      onSuccess: (data) => this.users.set(data)
    }
  );

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchGuard(value);
  }
}
```

---

### API Reference

#### `createRaceGuard(asyncFn, options?)`

* **`asyncFn`**: `(...args: any[], context: RaceGuardContext) => Promise<T>`
  * `context.signal`: The `AbortSignal` for this invocation.
  * `context.id`: Monotonically increasing invocation token.
  * `context.isStale()`: Returns `true` if a newer call has been initiated.

#### Options

| Option | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `abortStale` | `boolean` | `true` | Aborts the previous `AbortController` on new call. |
| `onStale` | `'reject' \| 'silent'` | `'reject'` | If `'silent'`, superseded calls resolve `undefined` without throwing. |
| `onSuccess` | `(data, ctx) => void` | `undefined` | Callback invoked **only** for the latest settled call. |
| `onError` | `(err, ctx) => void` | `undefined` | Callback invoked when the latest call fails. Errors of superseded calls and errors thrown by `onSuccess` do not reach it. |

#### Cancellation

You can manually abort in-flight requests anytime:

```typescript
safeSearch.cancel();
```

---

### License

MIT © [Mayuri Phad](https://github.com/mayuriphad)
