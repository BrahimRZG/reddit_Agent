---
inclusion: always
---

# Product Steering: Reddit Marketing Agent

## Product identity

**Product:** Reddit Marketing Agent
**Associated business:** CouponsRiver / couponsriver.com
**Form factor:** Chrome Extension plus Cloudflare Worker API
**Current build baseline:** PRD v3.3 hardened pre-implementation spec

## Product mission

Build a compliance-first Reddit research and drafting assistant that helps a human operator:

1. discover relevant public Reddit discussions;
2. understand user intent and subreddit risk;
3. retrieve useful CouponsRiver tool and coupon data;
4. draft helpful Reddit replies;
5. disclose commercial relationships whenever required;
6. manually review, copy, and post every reply.

The product must behave like a transparent Reddit trust-building assistant, not like an automation bot or spam system.

## Core positioning

The product should be framed as:

> A manual Reddit research and drafting co-pilot that helps operators participate well, build authority, and use disclosed promotional links only when context, subreddit rules, and user intent make them appropriate.

Do not frame it as:

- an auto-commenting tool;
- a Reddit bot;
- a hidden affiliate marketing tool;
- a mass outreach system;
- a way to bypass Reddit rules or moderators;
- a tool for generating fake social proof.

## Primary user

The MVP is for a single internal CouponsRiver operator or a small trusted internal team. Assume the operator can install an unpacked Chrome extension, configure tokens, understand basic compliance constraints, and review generated drafts before posting.

## Required behavior

The product must always preserve human control:

- The operator initiates scans, comparisons, and drafts.
- The operator reviews every draft.
- The operator manually posts on Reddit.
- The extension never writes to Reddit's posting UI.
- The extension never votes, DMs, follows, comments, or submits forms.

## Reply modes

The application supports three reply modes, with No-Link Authority as the safest default.

### Mode 1: No-Link Authority Reply

Purpose: build trust and help without promotion.

Rules:

- no affiliate link;
- no CouponsRiver link;
- no owned-resource CTA;
- no profile nudge;
- no commercial funnel language;
- usually no disclosure required unless the operator adds commercial self-reference.

This mode should remain available when promotional modes are locked, unless abuse is detected.

### Mode 2: Soft CTA Reply

Purpose: provide a helpful answer with limited self-reference or a non-direct CTA.

Rules:

- no direct affiliate link;
- any reference to CouponsRiver, the operator's profile, website, Discord, newsletter, tool list, or other owned asset triggers disclosure;
- counts as weighted promotional activity;
- locked when profile readiness is incomplete, subreddit risk is stale/high, or health is red.

Soft CTA must never become an undisclosed promotion loophole.

### Mode 3: Disclosed Link Reply

Purpose: include a CouponsRiver or affiliate link when the Reddit post directly supports it.

Rules:

- disclosure is always required;
- copy without disclosure is unavailable;
- locked when profile readiness is incomplete, subreddit risk is stale/high, or health is red;
- only allowed when tool fit and user intent are strong.

## Value formats

Generated replies should be useful even without a link. Prefer value-led structures:

- checklist;
- workflow;
- comparison;
- script/template;
- mistake list;
- pricing or tradeoff explanation.

Avoid vague, generic, repetitive, or hype-driven replies.

## Product success criteria

The product is successful when:

- a reasonable reviewer can see that a human remains in control;
- disclosures are clear and included where required;
- the system never automates Reddit engagement;
- generated replies are helpful enough to stand alone;
- promotional behavior is throttled, gated, and transparent;
- failure modes degrade safely without posting or manipulating Reddit.
