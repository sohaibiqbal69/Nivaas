import mongoose from 'mongoose';

// Side-effect registry of persisted application models. Keep it explicit so
// migrations inspect real schemas without booting HTTP routes or loading
// unrelated production authentication/CORS configuration.
import '../modules/approval/models/ApprovalDecision.js';
import '../modules/approval/models/CommitteeApprovalElectorate.js';
import '../modules/approval/models/CommitteeApprovalResult.js';
import '../modules/approval/models/CommitteeApprovalVote.js';
import '../modules/audit/models/AuditLog.js';
import '../modules/auth/models/AccountSetupCredential.js';
import '../modules/auth/models/AuthSession.js';
import '../modules/blockchain/models/BlockchainProofOperation.js';
import '../modules/budget/models/Budget.js';
import '../modules/budget/models/BudgetCategory.js';
import '../modules/committee/models/Committee.js';
import '../modules/committee/models/CommitteeMember.js';
import '../modules/complaint/models/Complaint.js';
import '../modules/complaint/models/ComplaintUpdate.js';
import '../modules/evidence/models/Evidence.js';
import '../modules/expense/models/Expense.js';
import '../modules/governance/models/GovernanceEligibilitySnapshot.js';
import '../modules/governance/models/GovernancePolicyConfiguration.js';
import '../modules/governance/models/GovernanceResolution.js';
import '../modules/governance/models/GovernanceVote.js';
import '../modules/governance/models/Meeting.js';
import '../modules/governance/models/OfflineResolutionRecord.js';
import '../modules/membership/models/Membership.js';
import '../modules/notice/models/Notice.js';
import '../modules/project/models/Project.js';
import '../modules/project/models/ProjectUpdate.js';
import '../modules/property/models/Building.js';
import '../modules/property/models/Flat.js';
import '../modules/property/models/Ownership.js';
import '../modules/property/models/Residence.js';
import '../modules/quotation/models/ChangeRequest.js';
import '../modules/quotation/models/Quotation.js';
import '../modules/society/models/Society.js';
import '../modules/society/models/SocietyRuleVersion.js';
import '../modules/users/models/LocalBootstrapClaim.js';
import '../modules/users/models/User.js';
import '../modules/vendor/models/Vendor.js';

export const schemaModels = Object.values(mongoose.models);
