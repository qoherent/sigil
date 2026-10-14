# Contributing to the Sigil skills

This section is for people who change the Sigil skills or cut a release. If you
only want to use Sigil, read the [install guides](../install/README.md). For
repository-wide rules (formatting, tests, where a change belongs, pull requests),
read [CONTRIBUTING.md](../../CONTRIBUTING.md).

Three pages cover the work:

| Page | Read it to |
| --- | --- |
| [Set up your environment](setup.md) | Install the tools, build `sigil` and `sigilc` from your checkout, and load the checkout's skills into your agent |
| [Work on a skill](skills.md) | Know what a skill is made of, which rules it keeps, when to bump its version, and how to run its eval |
| [Cut a release](releasing.md) | Publish skills, `sigil` and `sigilc` together |

## Your first skill change

1. Install the [tools](setup.md#tools) and build `sigil` and `sigilc` from the
   checkout, with both on your `PATH` ([setup](setup.md#build-the-tools-from-the-checkout)).
2. Remove any released Sigil plugin and old `sigil skill install` copies
   ([setup](setup.md#remove-released-copies)).
3. Load the checkout into your agent ([setup](setup.md#load-the-checkout-into-your-agent)).
4. Confirm the agent is using the checkout, not a released copy
   ([setup](setup.md#confirm-the-checkout-is-in-use)).
5. Edit the skill, and bump its version if the [rules](skills.md#when-to-bump-a-version)
   say so.
6. Run the [skill checks](skills.md#the-rules-and-the-check-for-each) and the
   skill's [eval](skills.md#run-an-observed-eval); record the result.
7. Open a pull request against `main`. Your change waits there for the next
   [release](releasing.md); it does not reach users before then.
