# Git

- Commits must not include a co-author trailer (e.g. `Co-authored-by: CommandCodeBot`); corrects it when present even after the commit was pushed. Confidence: 0.8
- Wants himself to be the only author in the repo — asks that no other author/committer identities appear in history. Confidence: 0.6
- Wants agent/learned-preference config (e.g. `.commandcode/taste`) committed to version control so project conventions travel with the repo, rather than left untracked. Confidence: 0.55
