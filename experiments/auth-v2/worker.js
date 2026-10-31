// Isolated compatibility spike. Never deployed; all identities are synthetic.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
const rpID = "auth.example.com";
const origin = "https://" + rpID;
let registrationChallenge, authenticationChallenge, credential;
export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/register/options") {
        const options = await generateRegistrationOptions({
          rpName: "JevSense compatibility spike",
          rpID,
          userID: new Uint8Array(32).fill(7),
          userName: "synthetic@example.com",
          attestationType: "none",
          supportedAlgorithmIDs: [-7],
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
          },
        });
        registrationChallenge = options.challenge;
        return Response.json(options);
      }
      if (url.pathname === "/register/verify") {
        if (!registrationChallenge) throw Error("consumed challenge");
        const challenge = registrationChallenge;
        registrationChallenge = null;
        const result = await verifyRegistrationResponse({
          response: await request.json(),
          expectedChallenge: challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
        if (result.verified) credential = result.registrationInfo.credential;
        return Response.json({
          verified: result.verified,
          deviceType: result.registrationInfo?.credentialDeviceType,
        });
      }
      if (url.pathname === "/authenticate/options") {
        const options = await generateAuthenticationOptions({
          rpID,
          userVerification: "required",
          allowCredentials: [{ id: credential.id, transports: ["internal"] }],
        });
        authenticationChallenge = options.challenge;
        return Response.json(options);
      }
      if (url.pathname === "/authenticate/verify") {
        if (!authenticationChallenge) throw Error("consumed challenge");
        const challenge = authenticationChallenge;
        authenticationChallenge = null;
        const result = await verifyAuthenticationResponse({
          response: await request.json(),
          expectedChallenge: challenge,
          expectedOrigin: url.searchParams.has("wrongOrigin")
            ? "https://wrong.example.com"
            : origin,
          expectedRPID: url.searchParams.has("wrongRP")
            ? "wrong.example.com"
            : rpID,
          credential,
          requireUserVerification: true,
        });
        if (result.verified)
          credential.counter = result.authenticationInfo.newCounter;
        return Response.json({ verified: result.verified });
      }
      return new Response("not found", { status: 404 });
    } catch {
      return Response.json({ verified: false }, { status: 400 });
    }
  },
};
