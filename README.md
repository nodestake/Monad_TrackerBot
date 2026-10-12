# Monad TrackerBot

**Your Monad activity, right inside Telegram.**

Monad TrackerBot brings wallet activity, staking rewards, and validator updates into one familiar chat. Add a public wallet address, choose what matters to you, and receive readable alerts with links to the on-chain record.

**[Open Monad TrackerBot](https://t.me/Monad_TrackerBot)**

## What you can do

| Feature | Experience in Telegram |
| --- | --- |
| MON transfers | Follow incoming and outgoing MON, with exact amounts and transaction links. |
| Token transfers | Keep track of ERC20 activity alongside your native balance movements. |
| Staking and rewards | Follow delegation, undelegation, withdrawals, and reward claims. |
| Validator monitoring | Watch validator activity, commission changes, and on-chain status. |
| Approval alerts | See allowance events, including revocations and maximum approvals. |
| Personal controls | Name wallets, set a minimum MON amount, and pause or resume monitoring. |
| English and Chinese | Use menus and readable notifications in your preferred language. |

No wallet connection or signing is required. Monitoring uses public addresses and confirmed on-chain records.

## Try the live bot

1. Open [@Monad_TrackerBot](https://t.me/Monad_TrackerBot) and tap **Start**.
2. Select English or Chinese.
3. Send a public Monad wallet address and optionally give it a name.
4. Open **My monitors** to choose categories, adjust the minimum MON amount, or pause a wallet.
5. Receive alerts for new activity after monitoring starts. Paused activity is not replayed when monitoring resumes.

## Public code

This repository is the public core edition prepared for the hackathon. It contains selected product logic from Monad TrackerBot and a self-contained, offline demonstration. The live bot provides the complete interactive experience; this repository focuses on the core decoding, validation, command parsing, and notification formatting.

| Module | Included logic |
| --- | --- |
| `src/monad.ts` | Address and hash validation, exact MON amounts, and finalized external transfer checks. |
| `src/erc20.ts` | Transfer candidates, mint/burn classification, receipt validation, and token amount formatting. |
| `src/staking.ts` | Staking event decoding, reward claims, and validator/delegator state decoding. |
| `src/approval.ts` | Approval event decoding and allowance classification. |
| `src/commands.ts` | Wallet commands, amount thresholds, category switches, and language selection. |
| `src/notifications.ts` | Readable MON transfer alerts, including failed-transfer wording. |
| `src/staking-notifications.ts` | Staking and reward alert text, grouping, and message pagination. |
| `src/i18n.ts` | Isolated English/Chinese rendering context. |
| `src/telegram-text.ts` | Escaped HTML and shortened explorer links. |
| `abi/staking.json` | Public Monad staking event signatures and function selectors. |

## Run the local example

Use **Node.js 24 or newer**. No package installation or account setup is needed.

```sh
node examples/demo.ts
node --test tests/*.test.ts
```

The example generates a MON transfer and a reward-claim notification in English and Chinese using synthetic transactions and addresses. It does not connect to a network or send messages.

## How events are checked

- External MON transfers must belong to the supplied canonical block, match their receipt, and be at or below the supplied finalized height.
- Token, approval, and staking logs must match the successful receipt and canonical block membership before they are treated as confirmed events.
- Amounts use integer arithmetic to preserve full precision.
- Repeated event identities are deduplicated; conflicting repeats are rejected.
- A standard event signature identifies a candidate event. It does not establish a token contract's identity or trustworthiness.

The caller is responsible for supplying authoritative block, receipt, and finality information. The offline fixtures demonstrate these checks with synthetic data.

## Team

Built by **NodeStake** for the Monad community.

Contact: **info@nodestake.org**
