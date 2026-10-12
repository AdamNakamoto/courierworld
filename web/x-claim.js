// Names from X: a player links their X account to their wallet and shows on the planet as their
// @handle instead of their wallet address. Shared by the game and the multiplayer server (no imports),
// so both build the same message.

/// What an X handle can be.
export const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/// The message a wallet signs to take @handle as its name, for one X sign-in (`claim`, from the server).
export const claimMessage = (wallet, handle, claim) =>
  `Courier World: show my X account @${handle} as my name on the planet.\n\nWallet: ${wallet}\nClaim: ${claim}\n\nSigning is free and sends no transaction.`;
