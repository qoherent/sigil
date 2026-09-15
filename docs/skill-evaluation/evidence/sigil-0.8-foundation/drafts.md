# Observed final design snapshots

These are fenced observations; no source file enters repository discovery.

## corrected-search

Run-relative path: `direct-B/search/panel.sigil`. SHA-256: `bf73a848db30dd4d5fce61acb0085e17bd7f9eed9e965107052d73d0d8cf9042`.

```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }
  interface {
    Publish matching records for the active request.
  }
  constraints {
    Only the active request may publish results.
    Cancelling a request immediately makes it inactive.
  }
  cases {
    A cancelled request completes after its replacement starts;
    the cancelled request must not publish its results.
  }
}
```

## policy-choice-archive

Run-relative path: `writer-B/archive/export.sigil`. SHA-256: `f3fa2968535120e191d19d4c45e966cb112f9df950a8e68d8723f6d823367fe9`.

```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }
  interface {
    Let an authorized user download a retained export.
    Downloading preserves the retained export for later downloads.
  }
  constraints {
    Only authorized users may download an export.
    Delete expired exports automatically.
  }
  decisions {
    The product owner has not yet chosen the retention duration.
  }
}
```

## retrieved-policy-archive

Run-relative path: `writer-C/archive/export.sigil`. SHA-256: `1969c2e10b4673dadb2c5423bb21baa5803e8f65e3ae52f0e99af4229777ab8f`.

```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }
  interface {
    Let an authorized user download a retained export.
  }
  constraints {
    Follow the adopted [retention policy](../policy/retention.md):
    retain completed exports for thirty days from completion, then delete
    them automatically. Downloading does not reset the expiry time.
  }
}
```

## no-delegation-search

Run-relative path: `writer-F/search-panel.sigil`. SHA-256: `b54e73bb2abc89020542ee72549354d535ce6b5ef03682b0fd907f9b94f815ea`.

```sigil
component SearchPanel {
  goal {
    Help users find matching records.
  }
  interface {
    Display matching records for the current search.
  }
  constraints {
    Only the active request may publish new results.
  }
}
```

## simplified-search

Run-relative path: `direct-D/search/panel.sigil`. SHA-256: `316f31fdf241548ac249d1f50e47f046a4b680958372618f57130fe69a00ca30`.

```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }
  interface {
    Display matching records.
    Starting a new request preserves the already displayed results until its replacement is ready.
  }
  constraints {
    Only the active request may publish new results.
  }
}
```

## new-reviewed-search

Run-relative path: `writer-new/search-panel.sigil`. SHA-256: `286b5c8365c53bcdf0af92bc69b8155288b9dc188114cdc9aecc111b49f85c26`.

```sigil
component SearchPanel {
  goal {
    Help users find matching records.
  }

  interface {
    Display matching records for the current search.
  }

  constraints {
    Only the active request may publish new results.
  }
}
```
