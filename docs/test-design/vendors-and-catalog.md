# Test design: vendors-and-catalog

Area: `GET /vendors`, `POST /vendors`, `GET /skus`.

Sources: `docs/API.md` (Basics, Errors, Seed data, Endpoints / Vendors, Endpoints / Catalog), OpenAPI `/vendors`, `/skus`, schemas `Vendor`, `VendorCreate`, `Sku`, `Error`, and `docs/QUESTIONS.md` §4.

Prerequisite for every case that depends on known seed state: `POST /admin/reset` first.

---

## GET /vendors

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| V-G-01 | positive | `GET /vendors` after reset | 200 | Array of 2 vendors: `{id:"vnd-001", name:"Maple Ridge Supply", active:true}` and `{id:"vnd-002", name:"Old Quarry Materials", active:false}` | API.md Seed data + Endpoints / Vendors; OpenAPI `Vendor` | happy path / seed state |
| V-G-02 | positive | `GET /vendors` after reset then `POST /vendors` with `{"name":"Cedar Point Hardware"}` | 200 | Array length 3; includes seed pair plus a vendor with `name:"Cedar Point Hardware"`, `active:true`, `id` starting with `vnd-` | API.md Endpoints / Vendors; OpenAPI `Vendor` | state / created vendor appears in list |

No business rules or 404 paths apply to this list endpoint. No documented query params or filters.

---

## POST /vendors

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| V-P-01 | positive | `{"name":"Cedar Point Hardware"}` | 201 | `Vendor`: `name:"Cedar Point Hardware"`, `active:true` (default), `id` string starting with `vnd-` | API.md Endpoints / Vendors; OpenAPI `VendorCreate` / `Vendor` | happy path / default |
| V-P-02 | positive | `{"name":"Active Co","active":true}` | 201 | `name:"Active Co"`, `active:true`, `id` starts with `vnd-` | API.md Endpoints / Vendors; OpenAPI `VendorCreate.active` | documented option |
| V-P-03 | positive | `{"name":"Inactive Co","active":false}` | 201 | `name:"Inactive Co"`, `active:false`, `id` starts with `vnd-` | API.md Endpoints / Vendors; OpenAPI `VendorCreate.active` | documented option |
| V-P-04 | positive | `{"name":"A"}` (shortest non-empty name) | 201 | `name:"A"`, `active:true`, `id` starts with `vnd-` | OpenAPI `VendorCreate.name` `minLength:1`; API.md “cannot be empty” | boundary (smallest valid) |
| V-P-05 | negative | `{}` (missing `name`) | 400 | `detail` present; `rule:"validation_error"` | API.md Endpoints / Vendors + Errors; OpenAPI `VendorCreate` required + 400 | equivalence class (missing field) |
| V-P-06 | negative | `{"name":""}` | 400 | `detail` present; `rule:"validation_error"` | API.md “cannot be empty”; OpenAPI `minLength:1` | equivalence class (empty string) / boundary (one under min) |
| V-P-07 | negative | `{"name":123}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `VendorCreate.name` type string; Errors | equivalence class (wrong type) |
| V-P-08 | negative | `{"name":"Ok","active":"yes"}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `VendorCreate.active` type boolean; Errors | equivalence class (wrong type) |
| V-P-09 | negative | `{"name":null}` | 400 | `detail` present; `rule:"validation_error"` | OpenAPI `VendorCreate.name` type string; Errors | equivalence class (wrong type / null) |
| V-P-10 | assumed — ask | `{"name":"X".repeat(N)}` for a very long `name` | — | — What is the maximum length for vendor `name`? | QUESTIONS.md §4 | not documented |
| V-P-11 | assumed — ask | Second identical `POST /vendors` with the same body as a successful create | — | — What happens on a second identical request (duplicate create with the same body)? | QUESTIONS.md §4 | not documented |
| V-P-12 | assumed — ask | Body `{"name":"No CT"}` without `Content-Type: application/json` (or with a non-JSON content type) | — | — What response is returned when `Content-Type` is missing or is not `application/json`? | QUESTIONS.md §4; API.md Basics | not documented |
| V-P-13 | assumed — ask | `{"name":"   "}` (whitespace-only name) | — | — Is a whitespace-only `name` treated as empty (rejected) or accepted? | QUESTIONS.md §4 (name emptiness / length gaps) | not documented |

No `404` path for create. None of the 11 named business rules reject `POST /vendors` (inactive vendors are still creatable; the gate applies later on POs).

---

## GET /skus

| ID | type | what we send | expected status | expected body (rule, key values) | source | technique |
| --- | --- | --- | --- | --- | --- | --- |
| S-G-01 | positive | `GET /skus` after reset | 200 | Array of exactly 5 SKUs with: `LUM-2X4-8` / "2x4 stud, 8 ft" / `4.75`; `PLY-12-4X8` / "Plywood sheet, 1/2 in, 4x8 ft" / `22.40`; `CEM-30KG` / "Cement bag, 30 kg" / `11.90`; `REB-10MM-6` / "Rebar, 10 mm, 6 m" / `18.25`; `SCR-DECK-1LB` / "Deck screws, 1 lb box" / `9.99` | API.md Seed data + Endpoints / Catalog; OpenAPI `Sku` | happy path / seed catalog |
| S-G-02 | positive | `GET /skus` after reset, then create a vendor (or any unrelated write), then `GET /skus` again | 200 | Same five SKUs and prices as S-G-01 (catalog unchanged by vendor create) | API.md Seed data (“catalog is for reference”); OpenAPI `/admin/reset` description | state / catalog stable |

No create/update/delete for SKUs in this area. No business-rule or 404 rows for the list endpoint.

---

## Coverage notes

| Endpoint | Business rules that apply | Covered by |
| --- | --- | --- |
| `GET /vendors` | none | — |
| `POST /vendors` | `validation_error` only (OpenAPI 400) | V-P-05 … V-P-09 |
| `GET /skus` | none | — |

Out of scope for this area (separate endpoint): `GET /vendors/{vendorId}/exposure` and rule `vendor_exposure_math`.
