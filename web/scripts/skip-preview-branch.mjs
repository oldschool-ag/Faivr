const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
const skip = branch.startsWith("dependabot/") || branch.startsWith("review/");

console.log(skip ? `Skipping preview deployment for ${branch}.` : "Building deployment.");
process.exitCode = skip ? 0 : 1;
