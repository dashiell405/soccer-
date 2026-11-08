/* Public Supabase values for the optional Kickoff account.
   Safe to ship in the browser: this is the publishable key, not a secret.
   Do not add a secret key here.
   The project ref written in the task (vjlibzagprrypsfsvxib) does not
   resolve. This URL is the Kickoff project that owns the key below. */
const SUPABASE_URL = "https://vjlibzagprrygmlsvxib.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_a_p7jTWnsHMjCCHnCMYtrQ_iW1YcS6G";
const KICKOFF_SITE_URL = "https://dashiell405.github.io/soccer-/";
/* The iPhone app sends magic links to this address so iOS can open Kickoff.
   A parent adds the same address in Supabase:
   Authentication → URL Configuration → Redirect URLs.
   The 6-digit code still works if that address is not on the list yet.
   Changing the bundle id does not change this address. */
const KICKOFF_APP_REDIRECT = "kickoff://login";
