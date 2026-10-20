# Code signing

How torta's installers get signed, what to set up the first time, and what to redo when
things expire.

Each side has two parts: proving who you are (slow, done once) and giving GitHub Actions
what it needs to sign every release (quick). Apple gives you a certificate file that goes
into GitHub. Azure never hands out a file: it keeps the certificate and signs on request,
so GitHub only gets a login.

Linux AppImages are not signed.

## Apple (macOS)

Without signing and notarization, macOS refuses to open torta until the user goes to
System Settings → Privacy & Security → "Open Anyway", and auto-update does not work.

1. **Join the Apple Developer Program** at
   [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/).
   $99 a year, with an Apple ID that has two-factor authentication. An organization also
   needs a D-U-N-S number.
2. **Create the certificate** on a Mac with the system `openssl`. You create the private
   key locally and send Apple only the request, which holds your public key. The key is
   the secret: anyone with it can sign as you.
   - In a new folder (not one iCloud syncs), create the key and the request:

     ```sh
     /usr/bin/openssl req -new -newkey rsa:2048 -nodes -keyout signing.key -out signing.csr \
       -subj "/emailAddress=<apple id email>/CN=<your name>/C=US"
     ```

   - At
     [developer.apple.com/account/resources/certificates/list](https://developer.apple.com/account/resources/certificates/list),
     click **+**, choose **Developer ID Application**, pick the **G2 Sub-CA**, and upload
     `signing.csr`. Only the account holder can create this type.
   - Download the certificate into the same folder and bundle it with the key into a
     `.p12`. The second command asks for an export password:

     ```sh
     /usr/bin/openssl x509 -inform DER -in developerID_application.cer -out signing.pem
     /usr/bin/openssl pkcs12 -export -inkey signing.key -in signing.pem -out torta.p12 \
       -name "Developer ID Application"
     ```

     Use `/usr/bin/openssl` (LibreSSL): Homebrew's OpenSSL 3 encrypts the `.p12` in a
     format older macOS keychains can't import unless you add `-legacy`.

   - Store `torta.p12` and its password in a password manager, and delete the folder once
     the GitHub secrets in step 3 are set. `signing.key` and `torta.p12` are secret.
3. **Add five repository secrets** under the repo's Settings → Secrets and variables →
   Actions:
   - `CSC_LINK`: the `.p12` as base64 (`base64 -i torta.p12 | pbcopy`).
   - `CSC_KEY_PASSWORD`: the password set on the `.p12`.
   - `APPLE_ID`: the email of the Apple developer account.
   - `APPLE_APP_SPECIFIC_PASSWORD`: notarization signs in to Apple with this instead of the
     real password. Create one at [account.apple.com](https://account.apple.com/) →
     Sign-In and Security → App-Specific Passwords.
   - `APPLE_TEAM_ID`: under Membership details at
     [developer.apple.com/account](https://developer.apple.com/account).

`.github/workflows/release.yaml` signs when `CSC_LINK` exists and notarizes when
`APPLE_ID` exists, on the macOS runner only.

## Azure Artifact Signing (Windows)

Without it, Windows shows SmartScreen's "Windows protected your PC" and "Unknown
publisher". Auto-update works either way. A new signature can still warn for a while until
SmartScreen has seen enough downloads.

Microsoft keeps the key and signs on request, so there is no file to back up. GitHub logs
in to Azure keylessly with a federated credential and asks Azure to sign.

### Setting it up

1. **An Azure pay-as-you-go subscription.** Free trials can't use Artifact Signing. The
   billing name and address must match your ID exactly: Microsoft copies them onto the
   certificate. Individuals must be based in the US or Canada.
2. **A signing account**: register the `Microsoft.CodeSigning` resource provider on the
   subscription, then create an Artifact Signing account (Basic tier).
3. **Identity validation**: give yourself the **Artifact Signing Identity Verifier** role
   on the account, then Identity validations → New → Public. Fix the billing name before
   submitting; a request made with the wrong name can get stuck.
4. **A certificate profile**: Certificate profiles → Create → Public Trust, once the
   validation is completed. Its CN is the publisher Windows shows, and it must match
   `publisherName` in `apps/server/electron-builder.yml` exactly.
5. **GitHub's login**: an app registration with a federated credential for GitHub Actions
   (this repository, entity Environment `release`) and the **Artifact Signing Certificate
   Profile Signer** role on the signing account. Azure matches the environment name
   exactly, which is why the release job runs in the `release` environment, limited to
   `v*` tags.
6. **torta's side**: `win.azureSignOptions` in `electron-builder.yml` (endpoint, account
   and profile names) and three repository secrets, all identifiers rather than passwords:
   `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` (the app registration's Overview page) and
   `AZURE_SUBSCRIPTION_ID`.

### How GitHub signs

On the Windows runner, `azure/login` trades GitHub's login token for an Azure login as the
app registration, with no stored password. electron-builder then reads
`win.azureSignOptions`, installs Microsoft's `TrustedSigning` PowerShell module and asks
the signing account to sign each `.exe`.

## Renewing and changing

- **Apple membership** renews every year. If it lapses, apps already signed keep opening,
  but new releases can't be signed or notarized.
- **The Developer ID certificate** lasts about a year; its expiry is in the certificates
  list on developer.apple.com. Apps signed before it expires keep working, because the
  signature is timestamped. Before it expires, repeat step 2 of the Apple section and
  replace `CSC_LINK` and `CSC_KEY_PASSWORD`. Keep the same Apple account: macOS only
  installs an update signed by the same Team ID as the installed app.
- **Azure** rotates its certificates itself. The identity validation does expire:
  Microsoft emails reminders from 60 days before, and signing stops if it lapses.
- **Moving from an individual to a company**:
  - Apple: ask Apple support to convert the individual account to an organization rather
    than enrolling a new one, so the Team ID, and therefore auto-update, carry over.
  - Windows: the company needs its own identity validation, which gives a new publisher
    name. The release that switches must list both names under
    `win.azureSignOptions.publisherName`, or existing installs stop auto-updating.
