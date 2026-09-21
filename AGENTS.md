# Final Notice release contract

- Preserve the game and all released versions. Never retag, force-push a published tag, replace old GitHub release assets, or alter files in an existing `docs/versions/vX.Y.Z/` directory.
- Increment package.json version for each published change; update CHANGELOG.md and run the archive build for that new version.
- Run engine tests, browser input checks, at least one legal full game, and packaged desktop checks for relevant changes. Verify the deployed browser game and actual GitHub release downloads before claiming publication.
- User data lives in a stable desktop profile, not a versioned game folder. Do not reset, delete, migrate, or overwrite saves without explicit authorization.
- Keep generated builds reproducible. Commit src, desktop, scripts, tests, and the versioned docs browser archive. Do not commit runtimes, credentials, private paths, or build scratch files.
- The user's explicit instructions govern publishing. A request to edit the game alone is not approval to publish it; a request to release/publish a specified new version is sufficient authorization.
