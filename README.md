# linux ai watch

`coding-assistants.rst` defines the Linux kernel's `Assisted-by:` attribution tag for AI-assisted work.

This repo turns that tag into a live GitHub Pages dashboard:

- a scheduled workflow queries the GitHub mirror of `torvalds/linux` for commits containing `Assisted-by:`
- the workflow stores the normalized snapshot in `site/data/adoption.json`
- the static site renders totals, subsystem adoption, assistant usage, monthly volume, and the latest attributed commits

The repo is its own database. Every scheduled run refreshes the published JSON and redeploys the site.
