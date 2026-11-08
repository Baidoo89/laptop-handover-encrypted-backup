# Private encrypted project backup

This repository contains a password-encrypted recovery backup. The password is not included. Keep this repository private and keep the password somewhere you control outside the handover laptop.

## Restore on your own Windows computer

1. Download or clone the entire repository. Extract GitHub's downloaded ZIP if you use Download ZIP.
2. Keep all `projects-and-settings.enc.NNN` files together with `backup-format.json`, `backup-crypto.mjs` and `Restore-Backup.ps1`.
3. Install Node.js 22 or newer from https://nodejs.org/ if it is not installed. Windows' `tar.exe` is also required.
4. In PowerShell, open this downloaded directory and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Restore-Backup.ps1
   ```

5. Enter the password you saved separately. The script restores into a new `Restored-Projects-*` directory, checks the encrypted volumes and password first, and refuses to overwrite an existing destination.
6. Review the restored source and settings privately. Reinstall dependencies before running projects. Never upload the restored environment files, keys, local databases, or old secrets packages as plain source.

## Contents

The backup contains the project source, local edits, project environment files, local data, and earlier handover packages from the laptop's `baidoo` workspace. This includes the older QuickData, foundation-concept and Sprint folders moved into that workspace before handover. Downloadable dependencies and generated build/tool caches are omitted. The private file manifest is inside the encrypted backup.

The two QuickData directories differ only in capitalization. To prevent overwriting one on a normal Windows filesystem, the older `SK-s-QuickData-Plug` copy is stored as `quickdata-older-ui-copy`. The current `sk-quickdata-plug` copy keeps its name.

Browser profiles, Windows sign-in tokens and saved development-account sessions are not backed up here. The separate Desktop `baidoo.zip` is not used as the recovery backup: it was over the normal Git file-size limit and could not be opened as a complete ZIP.

## Format and verification

The archive uses AES-256-GCM with a random 96-bit nonce and scrypt password derivation (`N=262144`, `r=8`, `p=1`, 256-bit salt). `backup-format.json` records the algorithm settings, authentication tag, and ordered 64 MiB encrypted volumes. Filenames and contents are encrypted. The implementation uses Node's standard crypto module, documented at https://nodejs.org/api/crypto.html.

`SHA256SUMS.txt` covers the encrypted volumes. `BACKUP-VERIFIED.json` records decryption, archive path coverage and rejection of a wrong password. The uploaded volumes are downloaded and checked again before local project removal. The format JSON and recovery scripts are essential; an individual `.enc` part is not a standalone ZIP or 7-Zip archive.

Source repositories and existing deployed websites remain separate from this private recovery archive.
