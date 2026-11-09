# Recon map: TradingView (Android, mobile app)

Scope: Core loop of the mobile app: watchlists -> symbol screen -> chart (indicators, drawings) -> cloud alerts. Plus ideas feed and a lightweight screener. Brokers and Pine Script editor are deferred.
For: the user's growing company (own product; must be rebranded before launch)
Date: 2026-11-09

> Confidence note: sources were fetched without the user's account and without screenshots. Screen list is inferred from store listings, help center nav and release notes. Verify each screen in the user's own account (human speed, user present) before /replica-build. Items marked (verify) are unconfirmed.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Google Play listing | https://play.google.com/store/apps/details?id=com.tradingview.tradingviewapp | page did not render text to the fetcher; open manually for screenshots |
| 2 | App Store listing | https://apps.apple.com/us/app/tradingview-stocks-crypto/id1205990992 | feature list, recent versions, IAP prices, 4.8 from ~424K ratings |
| 3 | pricing page | https://www.tradingview.com/pricing/ | plan limits (below) |
| 4 | help center | https://www.tradingview.com/support/ | nav: Mobile and Desktop apps, Supercharts, Screeners, Social network, Brokers, Trading |
| 5 | mobile blog | https://www.tradingview.com/blog/en/category/mobile | broker integrations, Minds, drawing snapping |
| 6 | paper trading article | https://www.tradingview.com/support/solutions/43000516466-tradingview-mobile-apps/ | web paper-trading flow: Trade button -> Paper Trading; order ticket, DOM, chart trading |
| 7 | user's own account | (needs user) | to confirm screens, states, navigation |

## Core loop

A trader watches a list of symbols, opens a symbol, analyses it on a full-featured chart with indicators and drawings, and sets a cloud alert that notifies them anywhere. Paid tiers raise the limits (indicators, alerts, layouts, data).

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Onboarding / sign in | first launch | email, Google, Apple sign in | auth buttons | signed out, error (verify) |
| S02 | Watchlist | main tab | live prices of saved symbols | list rows, flags, sections, chart preview toggle | empty, filled, loading, market closed |
| S03 | Symbol screen | tap a symbol | overview: price, session status, overview/metrics, news, ideas | header, tabs, mini chart | pre/post market, loading, no data |
| S04 | Chart | from symbol | candles, intervals, indicators, drawings | price scale, interval menu, toolbar | loading, offline, multi-chart (verify) |
| S05 | Indicators dialog | chart -> Indicators | search and add indicators | search, list, favorites | limit reached (plan) |
| S06 | Drawing tools | chart toolbar | trendlines, fibs, etc. incl. 45-degree snap | tool palette | selected, editing |
| S07 | Chart settings / Analysis hub | chart | appearance, scales, sessions | settings list | |
| S08 | Bar Replay | chart | replay history at chosen speed | play controls, auto interval | |
| S09 | Alerts list | alerts tab | manage alerts | list, status, filters | empty, active, triggered, limit |
| S10 | Create alert | chart / symbol | condition, trigger, expiry, delivery | form | validation error |
| S11 | Markets / screener | markets tab | screener, movers (verify) | filters, table | empty results |
| S12 | News and calendar | menu | news, economic, earnings, dividends | feed, filters | empty |
| S13 | Ideas / Minds feed | community tab | published ideas, short posts | cards, follow | empty, loading |
| S14 | Menu / profile / settings | menu | account, notifications screen, watchlist settings | list | |
| S15 | Paywall / plans | menu or limit hit | upgrade tiers | plan cards, trial | |
| S16 | Paper trading / broker panel | chart Trade button | order ticket, positions | ticket form | deferred |
| S17 | Widgets | OS home screen | price widgets | widget | |

## Flows

```
F01 Track a symbol
    S02 watchlist -> add symbol (search) -> S02
    happy path clicks: 3
    edge: watchlist symbol limit, symbol delisted, no data permission
F02 Analyse a chart
    S02 -> S03 -> S04 -> S05 add indicator -> S06 draw
    happy path clicks: 5
    edge: indicators-per-chart limit, connection loss, wrong time zone
F03 Set a price alert
    S04 -> S10 create alert -> S09 list
    happy path clicks: 4
    edge: alert cap, expired alert, notification permission denied
F04 Upgrade
    limit hit -> S15 -> store billing -> unlocked
F05 Replay history
    S04 -> S08 -> play/pause
F06 Read and publish ideas
    S13 -> read -> follow author
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Symbol row | with sparkline, with flag | up, down, halted, closed | S02, S11 |
| Candlestick chart | candles, line, area, bars | loading, error, replay | S04 |
| Interval menu | favorites, custom | selected | S04, S08 |
| Indicator list item | built-in, favorite | locked by plan | S05 |
| Alert form | price, indicator condition | invalid, saved | S10 |
| Bottom tab bar | 4-5 tabs | active | all |
| Paywall card | per plan | trial, current | S15 |
| Toast / banner | info, error | | all |

## Inferred data model

```
User         id, email, plan, settings
             evidence: S01, S14, S15; confidence: high
Symbol       id, ticker, exchange, type, currency, session info
             evidence: S02, S03; confidence: high
Watchlist    id, user_id, name, symbols[] (max 30 on Basic, 1000 paid)
             evidence: pricing page; confidence: high
Layout       id, user_id, symbol, interval, indicators[], drawings[]
             evidence: pricing "saved layouts"; confidence: medium
Alert        id, user_id, symbol, condition, value, trigger, expires_at, channels (app/email/webhook)
             evidence: App Store text, pricing alert caps; confidence: high
Idea         id, author_id, symbol, title, body, image
             evidence: S13; confidence: medium
Subscription user_id, tier (Basic/Essential/Plus/Premium/Ultimate), period, status
             evidence: pricing page, IAP list; confidence: high
```

Relationships: User 1-n Watchlist, User 1-n Layout, User 1-n Alert, Watchlist n-n Symbol, Idea n-1 Symbol.

## Plan limits (public pricing page, 2026-11-09)

Basic $0 / Essential $12.95 / Plus $29.95 / Premium $59.95 / Ultimate $199.95 per month billed annually. Indicators per chart 2/5/10/25/50. Charts per tab 1/2/4/8/16. Price alerts 3/20/100/400/1000. Watchlist symbols 30 (Basic), 1000 (paid). App Store monthly IAP: Essential $21.99, Plus $43.99, Premium $87.99.

## Feature matrix

See `features.csv`. Must: 10, should: 8, could: 5, skip: 5.

## Out of scope (cannot or should not be cloned)

- Market data: exchange feeds are licensed, per-user fees apply. Use a licensed vendor, not scraped data.
- The community and its users, published ideas and Minds content.
- Broker integrations and partner deals (regulated, per-broker agreements).
- Pine Script language itself and the indicator library (their IP). Offer a small set of standard indicators (SMA, EMA, RSI, MACD) written fresh.
- Name, logo, "Liquid Glass" visual identity, copy.

## Size

Screens 17, flows 6, entities 7. Hard parts: real-time quotes at scale with licensed data, a performant chart engine on mobile (consider an open library with a compatible licence, e.g. verify Lightweight Charts licensing and attribution terms), cloud alerts evaluated server-side with push/email/webhook. Size: XL for the full app. Rescoped to watchlist + chart + alerts: L.
