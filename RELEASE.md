# Releases

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and npm publishing. Releases are triggered automatically when commits following [Conventional Commits](https://www.conventionalcommits.org/) are pushed to the `main` branch.

## Quick reference

- `fix:` → Patch release (0.0.x)
- `feat:` → Minor release (0.x.0)
- `feat!:` or `BREAKING CHANGE:` → Major release (x.0.0)

## Local dry-run

```bash
pnpm release:dry
```

## Changesets

For local pre-release iteration you can also use changesets:

```bash
pnpm changeset
pnpm changeset version
```