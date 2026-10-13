# How well the scam check works

On 13 October 2026 I ran Spotter's real scam check on 80 text messages from a public dataset: 40 labelled scams and 40 ordinary texts. Every message went through the same path a forwarded text takes (`checkWordsOnly` with the live `aiCheck` and `extractPayment`), and "flagged" means Spotter said it has the signs of a scam.

| Precision | Recall | Ordinary texts called a scam | Failed checks |
| --- | --- | --- | --- |
| 93% | 93% (37 of 40) | 3 of 40 | 0 of 80 |

All 80 answers came from Claude (none from the backup model), about 6 seconds each.

## The data

[SMS Phishing Dataset for Machine Learning and Pattern Recognition](https://data.mendeley.com/datasets/f45bkkt8pr) by Sandhya Mishra and Devpriya Soni (Mendeley Data, 2022, CC BY 4.0). It has 5,971 texts labelled ham, spam and smishing. I took 40 random "smishing" texts as scams and 40 random "ham" texts as ordinary, with a fixed seed so anyone gets the same 80. Marketing "spam" is left out, because "is this a scam" is the question Spotter answers. The full dataset (all 5,971 texts) is in [eval/data/sms-phishing-dataset-5971.csv](../eval/data/sms-phishing-dataset-5971.csv), the 80 I ran are in [eval/data/sms-sample.json](../eval/data/sms-sample.json), every verdict with its reasons in [eval/results/2026-10-13.json](../eval/results/2026-10-13.json).

## What it got wrong

Three scams it let through. All three read like marketing more than fraud:
- "Dont forget you can place as many FREE Requests with 1stchoice.co.uk as you wish. For more Information call 08707808226."
- "FREE camera phones with linerental from 4.49/month ... Call 08001950382"
- "You have 1 new message. Call 0207-083-6089"

The last one is a classic premium rate trick, and Spotter should catch it. Nothing in the message asks for money, so the check found no clear sign. That's a real gap: a bare "call this number" text.

Three ordinary texts it flagged:
- "Sir, hope your day is going smoothly. i really hoped i wont have to bother you about this. I have some bills that i can't settle this month." Flagged as the money trouble opener scammers use. Honestly, I'd want a second look at that one too.
- "Life style garments account no please." Flagged for asking for account details with no context.
- "Hi Dev Call me its urgnt..." Flagged for rushing.

A false alarm in Spotter costs a question to the family's spotter, not a lost payment, so I'd rather it leans this way. Still, 3 of 40 is the number to bring down.

## Limits

80 messages is small. The dataset is mostly older UK and Indian texts, and it shares most of its ordinary texts with the classic UCI SMS collection. It doesn't cover the newer "Hi Mum, new number" family impersonation texts Spotter is built around, or hidden instructions on shop pages, which are tested separately in the scenario tests.

## Run it again

```
npx tsx --env-file=.env.local scripts/eval-scam-check.mts
```

Two model calls per message, about 1p each. Scoring is in [src/eval/score.ts](../src/eval/score.ts) with its tests.
