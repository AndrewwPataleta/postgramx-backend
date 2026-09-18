# Deal Flow

```mermaid
stateDiagram-v2
  [*] --> CREATIVE_AWAITING_SUBMIT

  CREATIVE_AWAITING_SUBMIT --> CREATIVE_AWAITING_CONFIRM: publisher submits creative
  CREATIVE_AWAITING_CONFIRM --> CREATIVE_AWAITING_FOR_CHANGES: advertiser requests edits
  CREATIVE_AWAITING_FOR_CHANGES --> CREATIVE_AWAITING_CONFIRM: publisher resubmits creative
  CREATIVE_AWAITING_CONFIRM --> SCHEDULING_AWAITING_SUBMIT: advertiser approves creative

  SCHEDULING_AWAITING_SUBMIT --> SCHEDULING_AWAITING_CONFIRM: publisher submits schedule
  SCHEDULING_AWAITING_CONFIRM --> SCHEDULE_AWAITING_FOR_CHANGES: advertiser requests schedule updates
  SCHEDULE_AWAITING_FOR_CHANGES --> SCHEDULING_AWAITING_CONFIRM: publisher resubmits schedule
  SCHEDULING_AWAITING_CONFIRM --> PAYMENT_AWAITING: advertiser approves schedule

  PAYMENT_AWAITING --> PAYMENT_PARTIALLY_PAID: partial on chain payment
  PAYMENT_PARTIALLY_PAID --> PAYMENT_AWAITING: waiting remaining amount
  PAYMENT_AWAITING --> POST_SCHEDULED: escrow funded

  POST_SCHEDULED --> POST_PUBLISHING: publication worker starts
  POST_PUBLISHING --> POSTED_VERIFYING: post sent to channel
  POSTED_VERIFYING --> DELIVERY_CONFIRMED: post verified
  DELIVERY_CONFIRMED --> FINALIZED: payout completed

  PAYMENT_AWAITING --> REFUNDING: payment timeout
  POST_SCHEDULED --> REFUNDING: canceled before post
  REFUNDING --> FINALIZED: refund completed
```

Mermaid source: `docs/diagrams/deal-lifecycle.mmd`

## Escrow and auto posting sequence

```mermaid
sequenceDiagram
  autonumber
  participant Adv as Advertiser
  participant API as Backend API
  participant TON as TON Chain
  participant Bot as Posting Worker
  participant Ch as Telegram Channel

  Adv->>API: create deal request
  API-->>Adv: deal in creative stage

  Adv->>API: approve terms
  API-->>Adv: deposit address and payment deadline

  Adv->>TON: send payment
  API->>TON: watch escrow address
  TON-->>API: payment detected
  API-->>Adv: stage is POST_SCHEDULED

  API-->>Bot: enqueue publish job
  Bot->>Ch: publish post
  Ch-->>Bot: message id
  Bot-->>API: publication created and POSTED_VERIFYING

  API->>Ch: verify message after delay
  Ch-->>API: verified
  API-->>API: release payout and finalize
```

Mermaid source: `docs/diagrams/deal-sequence.mmd`

## Lifecycle overview

Happy path:

`CREATIVE_AWAITING_SUBMIT`
→ `CREATIVE_AWAITING_CONFIRM`
→ `SCHEDULING_AWAITING_SUBMIT`
→ `SCHEDULING_AWAITING_CONFIRM`
→ `PAYMENT_AWAITING`
→ `POST_SCHEDULED`
→ `POST_PUBLISHING`
→ `POSTED_VERIFYING`
→ `DELIVERY_CONFIRMED`
→ `FINALIZED`

Change request loops:

- Creative feedback can move flow to `CREATIVE_AWAITING_FOR_CHANGES`
- Schedule feedback can move flow to `SCHEDULE_AWAITING_FOR_CHANGES`

Payment partial flow:

`PAYMENT_AWAITING` → `PAYMENT_PARTIALLY_PAID` → `PAYMENT_AWAITING`

Cancel and refund flow:

`PAYMENT_AWAITING` or review stages
→ `REFUNDING`
→ `FINALIZED`

## Who can trigger transitions

- Advertiser confirms creative and scheduling decisions
- Publisher submits creative and scheduling proposals
- System jobs process timeout cancel payment expiry and verification updates
- Payment services set escrow related transitions after blockchain checks

## Timeouts and auto cancel

Timeout worker scans deals with expired idle deadlines in review or scheduling stages.
Expired deals are canceled with timeout reason.

Payment timeout worker scans escrows with `AWAITING_PAYMENT` or `PAID_PARTIAL` and expired payment deadline.
Deal is canceled and partial funds can enter refund flow.

## Status groups

`DealStatus` groups map from stage values:

- `PENDING`
- `ACTIVE`
- `COMPLETED`
- `CANCELED`

This grouping is used for API list responses and UX sections.

## Related entity statuses

Creative status:

- `DRAFT`
- `RECEIVED_IN_BOT`
- `REJECTED`
- `APPROVED`

Escrow status:

- `CREATED`
- `AWAITING_PAYMENT`
- `PAID_PARTIAL`
- `PAID_HELD`
- `REFUND_PENDING`
- `REFUNDED`
- `PAYOUT_PENDING`
- `PAID_OUT`
- `FAILED`

Publication status:

- `NOT_POSTED`
- `POSTED`
- `VERIFIED`
- `FAILED`
- `DELETED_OR_EDITED`
