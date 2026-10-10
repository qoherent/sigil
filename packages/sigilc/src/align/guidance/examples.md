# Code observations and their mappings

SearchService promises search results for a query. A search function that
matches records delivers those results:

```rust
fn search(query: &str) -> Vec<Record> { records_matching(query) }
```

```
(element "search" "function")
(realizes "search" "SearchService")
(realizes "search" "SearchService::search results")
(act "search" "uses" "SearchService::query")
```

SearchPanel owns an active request and invokes the service. In the panel's
own file, a function replacing the active request and requesting results is:

```
(element "refresh" "function")
(realizes "refresh" "SearchPanel")
(realizes "refresh" "SearchPanel::active request")
(act "refresh" "owns" "SearchPanel::active request")
(act "refresh" "invokes" "SearchService")
(act "refresh" "uses" "SearchService::search results")
```

Calling the service does not make `refresh` a member of SearchService.

Booking has a booking request constrained to seven days and no more than 180
days ahead. Code checks both limits in validate_request:

```
(element "validate_request" "function")
(realizes "validate_request" "Booking")
(realizes "validate_request" "Booking::booking request")
(measure "validate_request" "durationDays" "7")
(measure "validate_request" "leadDays" "180")
```

The Tag realization connects both measured limits to the booking request,
while the separate component realization accounts for validation work.

An undocumented export helper in that same Booking file writes all database
records as CSV. No Booking claim accounts for export. The correct answer is:

```
(element "export_records" "function")
```

Leave it unmapped. Sharing a file with validate_request is no design evidence.

A search test exercises SearchService and search results:

```
(element "test_search" "test")
(realizes "test_search" "SearchService")
(realizes "test_search" "SearchService::search results")
```

This accounts for the test; it cannot deliver the service's promised results.
