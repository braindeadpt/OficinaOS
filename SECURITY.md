# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Use GitHub's [Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository (Security → Report a vulnerability).

If the vulnerability also affects upstream, consider reporting it to the original author at [cranknet/reparilo](https://github.com/cranknet/reparilo) as well.

Please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- The version / commit SHA you tested against
- Any suggested mitigation, if you have one

## What to expect

OficinaOS is maintained on a best-effort basis. We'll do our best on the following timelines but cannot guarantee them:

| Stage                  | Target                                    |
| ---------------------- | ----------------------------------------- |
| Acknowledgement        | within 5 business days                    |
| Initial assessment     | within 10 business days                   |
| Fix or mitigation plan | depends on severity and complexity        |
| Public disclosure      | coordinated with reporter, after the fix  |

If you don't get an acknowledgement within a week, please send a polite follow-up — your first message may have been missed.

## Scope

In scope:

- The OficinaOS application code in this repository (server, frontend, mobile)
- Authentication, session handling, CSRF, file upload, and authorization flows
- SQL injection, XSS, SSRF, or other injection vulnerabilities in our code
- Insecure defaults in `.env.example` or the seed script

Out of scope:

- Vulnerabilities in third-party dependencies (please report those upstream; we'll update once a fix is released)
- Issues that require physical access to a self-hosted server
- Social engineering of project maintainers
- Self-hosted instances misconfigured by their operators (e.g., weak admin passwords, exposed databases, missing TLS)
- Best-practice suggestions without a concrete vulnerability

## Safe harbor

If you make a good-faith effort to follow this policy, I will not pursue or support any legal action against you for security research conducted on this codebase.

## Supported versions

Only the latest commit on `main` receives security updates. There are no LTS branches.
