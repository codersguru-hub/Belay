import type { CommandPolicyClass } from "@agentmesh/contracts";
import type { CommandTemplate } from "../executor/command-registry.js";

export interface PolicyDecision {
  classification: CommandPolicyClass;
  version: string;
  reason: string;
}

export class PolicyEngine {
  classify(template: CommandTemplate): PolicyDecision {
    const version = template.policyVersion ?? "local-policy-v1";
    if (template.policyClass === "deny") {
      return { classification: "deny", version, reason: template.policyReason ?? "Denied by registered policy." };
    }
    if (template.policyClass === "approval_required") {
      return {
        classification: "approval_required",
        version,
        reason: template.policyReason ?? "Human review is required."
      };
    }
    return { classification: "auto_allow", version, reason: "Registered low-risk local command." };
  }
}
