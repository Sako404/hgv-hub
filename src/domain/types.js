// Domain typedefs for the workspace/driver/organisation model.
// No runtime code — JSDoc only, kept in sync with storage/keys.js collections.

/** @typedef {'personal'|'agency'|'transport_company'} WorkspaceKind */
/**
 * 'transport_manager' — a UK O-licence Transport Manager, added for
 * the Transport Manager compliance dashboard (see
 * decision-2026-08-04-working-time-transport-manager-architecture).
 * Deliberately distinct from 'manager': the TM's "continuous and
 * effective management" duty (Senior Traffic Commissioner Statutory
 * Document No. 3) is personal to a specific named individual, not a
 * generic company-management permission — see
 * `docs/TRANSPORT_MANAGER_ARCHITECTURE_PROPOSAL.md` §1. Included in
 * `workspaceService.MANAGER_ROLES` (so a TM sees the workspace
 * switcher like any other manager-tier role), but the TM dashboard
 * screen itself gates on this role specifically, not on manager-tier
 * generally — the first screen in this app with that narrower gate.
 * @typedef {'driver'|'owner'|'admin'|'manager'|'dispatcher'|'payroll'|'viewer'|'transport_manager'} Role
 */

/**
 * @typedef {Object} Workspace
 * @property {string} id
 * @property {WorkspaceKind} kind
 * @property {string} name
 * @property {string|null} ownerPersonId - set when kind === 'personal'
 * @property {string} createdAt
 */

/**
 * A Person is a global identity, not inherently a driver — the same
 * Person may hold a DriverProfile in one workspace and be a manager/
 * dispatcher elsewhere, or neither. `name` is a LEGACY (pre-Part-4C)
 * single-string field, kept only for rows that predate structured
 * names; new code writes firstName/lastName/displayName instead and
 * never reads either field set directly — use
 * driverService.resolvePersonDisplayName(person) for display.
 * @typedef {Object} Person
 * @property {string} [name] - legacy full name, pre-Part-4C rows only
 * @property {string} id
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {string|null} [displayName] - optional override (e.g. a preferred name); falls back to "firstName lastName" when unset
 * @property {string|null} email
 * @property {string|null} archivedAt - reserved for a future "deactivate this identity everywhere" action; Stage 4C's per-workspace driver archive/restore acts on DriverProfile, not this field
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Membership
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} personId
 * @property {Role[]} roles
 * @property {string|null} archivedAt - deactivates access to this workspace without touching the global Person or their history
 * @property {string} createdAt
 */

/** @typedef {'agency'|'transport_company'|'client'|'customer'|'subcontractor'|'other'} OrganisationType */

/**
 * @typedef {Object} Organisation
 * @property {string} id
 * @property {string} workspaceId - the workspace that manages this organisation record (not necessarily the workspace this org "owns" — a workspace also records its clients/customers as Organisation rows here)
 * @property {string} legalName
 * @property {string} tradingName
 * @property {OrganisationType[]} types - non-empty; an org can carry more than one (e.g. a transport company that's also another agency's client)
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Site
 * @property {string} id
 * @property {string} organisationId - the organisation that physically operates this site (a client org for a client site, or the workspace's own self-org for its own depot). Locked once any Assignment has ever referenced this site — see siteService.updateSite.
 * @property {string} name
 * @property {'hub'|'depot'|'client_site'} kind
 * @property {string|null} clientName - legacy free-text field, superseded by organisationId -> Organisation.tradingName; left unused on old rows
 * @property {string|null} address
 * @property {string|null} notes
 * @property {string|null} archivedAt
 */

/**
 * Workspace-scoped: one row per person PER company workspace that
 * manages them as a driver — mirrors Organisation/Site/RateCardLineage's
 * existing "workspaceId = the workspace that manages this record"
 * convention, NOT a single global profile. A person driving for two
 * different agencies has two DriverProfile rows (e.g. each may assign a
 * different reference number, and one company archiving "their" driver
 * must never affect the other's). Membership — not DriverProfile — is
 * the authorization/roster mechanism (see Membership.roles); a person
 * with no DriverProfile row for a workspace is still treated as an
 * active driver there as long as their Membership carries the 'driver'
 * role — the row only exists to carry additional workspace-specific
 * operational state once there's something to say (see
 * driverService.js, which lazily creates one on first edit/archive).
 * @typedef {Object} DriverProfile
 * @property {string} id
 * @property {string} personId
 * @property {string} workspaceId
 * @property {string|null} referenceNumber
 * @property {number} defaultBreakMinutes
 * @property {string|null} lastUsedAssignmentId - automatically overwritten after each successful createShift/updateShift that has an assignment. Never user-set, never presented as a "default" — purely "what did I use last" for the Add Shift picker's initial selection.
 * @property {string|null} preferredAssignmentId - the OPPOSITE of lastUsedAssignmentId: explicitly set by the driver from the Workplaces screen (driverService.setPreferredAssignment), never auto-overwritten by a shift save. Takes priority over lastUsedAssignmentId when resolving the Add Shift picker's default (see DriverApp's defaultAssignment); falls back to lastUsedAssignmentId, then the first active assignment, when unset or no longer active.
 * @property {string|null} archivedAt - "no longer an active driver for THIS workspace"; independent of Membership.archivedAt (broader workspace access) and Person.archivedAt (global identity)
 * @property {string} createdAt
 */

/** @typedef {'employee'|'agency_worker'|'subcontractor'|'self_employed'|'other'} RelationshipType */

/**
 * Engagement is always driver-specific: one row per (driver, provider
 * organisation) employment/supply relationship. A driver may hold
 * multiple concurrently-active Engagements (e.g. two different
 * agencies at once) — this is valid and intentional, not an error
 * state. Ending an Engagement (endEngagement, engagementService.js)
 * is blocked while any Assignment through it is still active/would
 * outlive it — see docs/ARCHITECTURE.md and the Stage 4D decision
 * record for the no-cascade rule.
 * @typedef {Object} Engagement
 * @property {string} id
 * @property {string} providerOrganisationId - the organisation supplying/employing the driver (renamed from employerOrganisationId in migration 008 — "provider" covers employer/agency/subcontractor supplier uniformly, and matches Placement.providerOrganisationId's name so assignmentService's compatibility check is a plain equality). The create form defaults this to the workspace's own self-organisation, but the picker is open to any organisation in the workspace.
 * @property {string} [employerOrganisationId] - LEGACY (pre-Stage-4D) field name, kept only for rows that predate the rename; new code never reads it — use providerOrganisationId.
 * @property {string} workspaceId - == organisation's workspace (source of truth owner)
 * @property {string} driverId - == Person.id
 * @property {RelationshipType} relationshipType - renamed from `role` in migration 008: Membership.roles is the authorization/access concept, this is an unrelated employment-law-adjacent classification.
 * @property {'agency_worker'|'employee'|'subcontractor'} [role] - LEGACY (pre-Stage-4D) field name, kept only for rows that predate the rename; new code never reads it — use relationshipType.
 * @property {string} startDate
 * @property {string|null} endDate - null = active
 * @property {'active'|'ended'} status
 */

/**
 * The shared, driver-agnostic "work context" — the complete reusable
 * placement a workspace offers (e.g. "Example Driver Agency supplying drivers
 * to Example Logistics's Depot A/Norwood site, priced on lineage A"). Multiple
 * drivers' Assignments can reference the SAME Placement row — this is
 * the entity that eliminates per-driver duplication of
 * provider+site+rate configuration (Stage 4D). `siteId` deliberately
 * does not duplicate the client organisation — Site.organisationId
 * already IS that link. `providerOrganisationId`/`siteId`/
 * `rateCardLineageId` lock once any Assignment has ever referenced
 * this Placement (see placementService.updatePlacement) — same
 * re-parenting-lock pattern Site already established for its own
 * organisationId.
 * @typedef {Object} Placement
 * @property {string} id
 * @property {string} workspaceId - the workspace managing this placement (may be a solo driver's own personal workspace — no company workspace required)
 * @property {string} providerOrganisationId - the supplying/employing organisation this shared context belongs to; must match an Assignment's Engagement.providerOrganisationId (enforced in assignmentService.createAssignment) so an agency's Engagement can never be attached to a different agency's Placement
 * @property {string} siteId - the client site
 * @property {string} rateCardLineageId - references a RateCard *lineage*, not one pinned version; see RateCard below
 * @property {string} effectiveFrom
 * @property {string|null} effectiveTo
 * @property {string|null} archivedAt - hides from new-Assignment pickers; existing Assignments/Shifts unaffected
 * @property {string} createdAt
 */

/**
 * Thin, driver-specific link: "this driver (via this Engagement) is
 * on this shared Placement, from this date." Never carries site/rate
 * data directly — that lives once on the Placement, shared across
 * every driver assigned to it. Ending (endAssignment) is the only
 * lifecycle action — there is deliberately no "reactivate"; a new
 * stint on the same Placement after a gap is a new Assignment row, so
 * history stays unambiguous.
 * @typedef {Object} Assignment
 * @property {string} id
 * @property {string} engagementId - which driver, via which employment relationship
 * @property {string} placementId - which shared work context
 * @property {string} [siteId] - LEGACY (pre-Stage-4D) field, kept only on rows migration 008 has not yet needed to strip; new code never reads it — resolve via placementId -> Placement.siteId instead.
 * @property {string} [rateCardLineageId] - LEGACY (pre-Stage-4D) field, same as siteId above — resolve via placementId -> Placement.rateCardLineageId instead.
 * @property {string} startDate - this driver's start ON this placement
 * @property {string|null} endDate - null = still active; this driver's end on this placement (does not end the Placement itself)
 */

/**
 * @typedef {Object} Shift
 * @property {string} id
 * @property {string} workspaceId - OWNING workspace (source of truth)
 * @property {string} driverId - == Person.id, the cross-workspace query key for "my history"
 * @property {string|null} assignmentId - null => unpriced / no employer link yet
 * @property {string} date - "YYYY-MM-DD"
 * @property {string} start - "HH:MM"
 * @property {string} end - "HH:MM"
 * @property {number} breakMinutes
 * @property {number} drivingHours
 * @property {string|null} rateCardId - the EXACT RateCard version pinned at creation (or re-pinned on a date/assignment change) — never re-resolved live. See rateCardService.js.
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {'manual'|'migration'} source
 */

/** @typedef {'hourly'|'per_load'} PayType */

/**
 * The lineage's mutable metadata — separate from the immutable
 * versioned RateCard rows below, since "archived"/"name" are
 * lineage-level concerns that append-only versioning must never touch.
 * `id` equals the lineage's first RateCard version's own id (the same
 * value every RateCard.lineageId in that lineage carries).
 * @typedef {Object} RateCardLineage
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name - the single mutable display label, editable without creating a new rate version
 * @property {PayType} payType - set once at creation (createRateCard/createSoloWorkContext), never exposed as editable afterward — same "locked once meaningful" spirit as Site.organisationId, just enforced by omission rather than an explicit guard, since no mutator exists. 'per_load' means every RateCard version in this lineage carries an empty/unused `rates` object — see the per-load-pay architecture proposal.
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */

/**
 * RateCard version history is append-only — a revision never mutates
 * an existing row (not even to backfill when it stopped applying); it
 * inserts a new row in the same lineage. `lineageId` references a
 * RateCardLineage (above), which owns the mutable name/archived state.
 * resolveEffectiveRateCard() (rateCardService.js) determines which
 * version was effective on a given date; nothing here is ever mutated
 * after insert. See docs/ARCHITECTURE.md.
 * @typedef {Object} RateCard
 * @property {string} id
 * @property {string} workspaceId - owning org workspace (or personal, for a self-rate)
 * @property {string} lineageId - references RateCardLineage.id
 * @property {number} version - 1, 2, 3, ... within the lineage
 * @property {string|null} supersedesId - the RateCard.id this version replaces, or null for the first version
 * @property {string} effectiveFrom
 * @property {Object<string, Object<string, [number, number]>>} rates - rates[dayCategory][window] = [baseRate, holidayIncRate]. Empty ({}) and unused when the lineage's payType is 'per_load'.
 */

/**
 * One paid trip/load within a Shift — the unit of pay for a
 * 'per_load' RateCard (see PayType above and the per-load-pay
 * architecture proposal). `amount` is entered directly, never
 * derived: unlike every other priced value in this app, there is no
 * formula to resolve it from — real-world per-load rates are
 * negotiated per booking/contract (e.g. an Amazon Relay spot load),
 * not computed from hours or distance. Multiple Loads may reference
 * the same Shift (a driver can run several paid legs in one shift).
 * Owned by the same workspace as its Shift. Plain CRUD, unlike
 * RateCard's append-only versioning — a Load has no "historical
 * pinning" concern of its own, since its amount IS the pinned value
 * already, entered once.
 * @typedef {Object} Load
 * @property {string} id
 * @property {string} workspaceId - == the owning Shift's workspaceId
 * @property {string} shiftId
 * @property {string|null} reference - booking/load reference number, optional
 * @property {string|null} description - e.g. route, broker/platform name ("Amazon Relay — Load #1234")
 * @property {number} amount - the agreed £ total for this load
 * @property {number|null} distanceMiles - optional, record-keeping only — never read by any calculation
 * @property {string} createdAt
 */

/** @typedef {'rigid'|'tractor_unit'|'trailer'|'van'|'other'} VehicleType */

/**
 * A check-target identity, not a fleet-management record — no
 * scheduling, allocation, or general maintenance history (see
 * docs/ARCHITECTURE.md's "NOT built yet" list, narrowed by the Vehicle
 * Check module, not removed from it). Owned by the workspace that
 * operates it, same convention as Site/Organisation. See
 * [[decision-2026-08-03-working-time-vehicle-check-module-architecture]].
 * `motExpiryDate`/`insuranceExpiryDate` (added for the Transport
 * Manager dashboard, see
 * decision-2026-08-04-working-time-transport-manager-architecture) are
 * a narrow, named exception to "identity-only" — vehicle
 * roadworthiness is a core Transport Manager statutory duty, so these
 * two expiry dates are tracked, but nothing else fleet-management-
 * shaped (no service history, no tax/VED, no scheduling/allocation).
 * Status for either is derived with `documentExpiryEngine.
 * resolveDocumentStatus({expiryDate: vehicle.motExpiryDate}, today)` —
 * the same function DE-1 built for DriverDocument expiry, reused
 * unchanged since the shape is identical.
 * @typedef {Object} Vehicle
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} registration
 * @property {VehicleType} vehicleType
 * @property {string|null} make
 * @property {string|null} model
 * @property {string|null} notes
 * @property {string|null} motExpiryDate - "YYYY-MM-DD"; the goods vehicle's MOT/annual test expiry — DVSA's own guidance and downloadable-certificate service use "MOT" for HGVs over 3.5t, not a car-specific term (see the Transport Manager architecture proposal's Sources)
 * @property {string|null} insuranceExpiryDate - "YYYY-MM-DD"
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */

/**
 * The configurable set of check items a workspace uses for its daily
 * walkaround. Mutable — editing it must NEVER change what a past
 * VehicleCheck recorded (VehicleCheck snapshots `items` at submission
 * time, the same "pin at creation" pattern RateCard/Shift.rateCardId
 * already established for pay). Exactly one template per workspace has
 * `isDefault: true` at a time — see
 * checklistTemplateService.setDefaultChecklistTemplate.
 * @typedef {Object} ChecklistTemplate
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {{code: string, label: string, category: string}[]} items - ordered; `code` is stable across edits so a future historical reference (e.g. a Defect) can still name "which item," `label`/`category`/order may change freely
 * @property {boolean} isDefault
 * @property {string|null} archivedAt
 * @property {string} createdAt
 */

/** @typedef {'ok'|'defect'|'not_applicable'} VehicleCheckItemResult */

/**
 * A completed daily walkaround (Stage VC-2). `items` is a SNAPSHOT
 * copied from the active ChecklistTemplate at creation, not a live
 * reference — editing the template afterward must never change what
 * this check recorded (see ChecklistTemplate above).
 * `workspaceId`/`driverId` mirror Shift's split exactly: workspaceId
 * is the OWNING workspace (the Vehicle's — may be an employer/agency
 * workspace, not the driver's own), driverId (== Person.id) is the
 * cross-workspace "my check history" key. `overallResult` is computed
 * from `items` once at save time and stored, not recomputed live — the
 * same "pin at creation" reasoning as Shift.rateCardId.
 * `pairedVehicleId` (added for tractor+trailer combinations, see
 * decision-2026-08-04-working-time-owner-operator-architecture) covers
 * one check submission spanning two physical vehicles rather than
 * requiring two separate submissions. Each `items[]` entry carries its
 * OWN `vehicleId` (which of `vehicleId`/`pairedVehicleId` it was
 * actually checked against) so a failed item raises a Defect against
 * the correct vehicle — for an unpaired check every item's `vehicleId`
 * is simply the check's own `vehicleId`, no behaviour change there.
 * @typedef {Object} VehicleCheck
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} driverId - == Person.id
 * @property {string} vehicleId - the primary vehicle (e.g. the tractor unit, when paired)
 * @property {string|null} pairedVehicleId - the paired vehicle (e.g. the trailer), or null for a normal single-vehicle check
 * @property {string|null} shiftId - optional link to the Shift this check was performed for
 * @property {string} checklistTemplateId - which template was snapshotted, for audit trail — never used to re-resolve items
 * @property {{code: string, label: string, category: string, result: VehicleCheckItemResult, notes: string|null, vehicleId: string}[]} items - snapshot, see above; vehicleId is which physical vehicle (vehicleId or pairedVehicleId) this item's result belongs to
 * @property {'ok'|'defects_found'} overallResult
 * @property {number|null} odometerReading
 * @property {string} performedAt - ISO timestamp
 * @property {string} driverSignOffName - typed confirmation + timestamp, NOT a captured e-signature (no signature-capture UI anywhere in this app)
 * @property {string} createdAt
 */

/** @typedef {'minor'|'major'|'dangerous'} DefectSeverity */
/** @typedef {'open'|'reported'|'in_progress'|'resolved'} DefectStatus */

/**
 * A vehicle defect (Stage VC-3) — auto-created from a failed
 * VehicleCheck item (see vehicleCheckService.createVehicleCheck /
 * defectService.raiseDefectsFromVehicleCheck), never raised standalone
 * in v1 (deferred, see the module's architecture proposal). Owned by
 * the same workspace as its Vehicle. `status` is a linear workflow —
 * open → reported → in_progress → resolved — with no "reactivate",
 * mirroring Assignment's own no-reactivate rule: a recurring issue
 * after "resolved" is a new Defect row, so history stays unambiguous.
 * @typedef {Object} Defect
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} vehicleId
 * @property {string|null} raisedFromCheckId - the VehicleCheck this came from, null if raised standalone (not built in v1)
 * @property {string|null} raisedFromItemCode - which checklist item, if from a check
 * @property {string} raisedByDriverId - == Person.id
 * @property {DefectSeverity} severity - defaults to 'minor' when auto-raised (the check form doesn't collect per-item severity)
 * @property {string} description
 * @property {DefectStatus} status
 * @property {string|null} resolvedAt
 * @property {string|null} resolvedNotes
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ComplianceProfileRules
 * @property {number} reducedRestMaxPerCycle
 * @property {number} minRestHardHours
 * @property {number} reducedRestUpperHours
 * @property {number} cycleResetGapHours
 * @property {number} absoluteMaxDailyHours
 * @property {number} longShiftThresholdHours
 * @property {number} longShiftMaxPerCycle
 * @property {number} drivingHardLimitHours
 * @property {number} extendedDrivingThresholdHours
 * @property {number} extendedDrivingMaxPerWeek
 */

/**
 * ComplianceProfile is platform-level ('default') or driver-scoped — never
 * organisation-scoped. This is the rule that keeps the compliance engine
 * generic (see docs/ARCHITECTURE.md).
 * @typedef {Object} ComplianceProfile
 * @property {string} id
 * @property {'default'|string} scope - 'default' or a specific driverId
 * @property {ComplianceProfileRules} rules
 */

/**
 * 'tm_cpc' — a Transport Manager CPC, a DIFFERENT qualification from
 * 'cpc_card' (the Driver CPC): see
 * decision-2026-08-04-working-time-transport-manager-architecture.
 * Unlike Driver CPC, a TM CPC has no periodic 5-year retraining cycle
 * this app models — `expiryDate` is left unused in practice for this
 * type (usually null); the row exists mainly to record that a person
 * holds one, via `referenceNumber` (certificate number).
 * @typedef {'driving_licence'|'tacho_card'|'cpc_card'|'other'|'tm_cpc'} DriverDocumentType
 */

/**
 * A person's own legal document and its expiry date — driving licence,
 * digital tachograph card, Driver CPC card, Transport Manager CPC
 * ('tm_cpc', a different qualification from the Driver CPC — see
 * DriverDocumentType), or an open-ended 'other'. Named "DriverDocument"
 * for its 2026-08-04 origin (driver-scoped documents), but the
 * `tm_cpc` addition means the name now covers any person's own
 * document, driver or not — not renamed, to avoid a mechanical churn
 * across every existing reference. PERSON-scoped, not workspace-scoped
 * (see
 * decision-2026-08-04-working-time-driver-document-expiry-architecture
 * in the Brain and this project's
 * docs/DRIVER_DOCUMENT_EXPIRY_ARCHITECTURE_PROPOSAL.md §1) — the first
 * entity in this app with no `workspaceId` at all, alongside `Person`
 * itself: a driving licence isn't a fact any one employer owns, and
 * duplicating it per company workspace would risk two copies silently
 * disagreeing. A company workspace may only ever READ these, via an
 * active Membership (see docs/ARCHITECTURE.md) — driverDocumentService's
 * mutators are only ever called from the document owner's own
 * driver-side screen, never from a company-side one.
 * @typedef {Object} DriverDocument
 * @property {string} id
 * @property {string} personId
 * @property {DriverDocumentType} documentType
 * @property {string|null} label - required and shown when documentType is 'other' (e.g. "ADR certificate"); ignored for the three named types, which get a fixed translated label instead
 * @property {string|null} referenceNumber - optional, e.g. licence number; record-keeping only, never validated against a real format
 * @property {string|null} expiryDate - "YYYY-MM-DD"; null means "tracked but no known expiry date yet," distinct from not having a DriverDocument row at all
 * @property {string|null} notes
 * @property {string|null} archivedAt - "no longer tracking this document" — a renewal creates a NEW row with the new expiryDate and archives this one (see driverDocumentService.renewDriverDocument), never an in-place date edit, so expiry history stays honest (same reasoning RateCard's append-only versioning already established elsewhere in this app)
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * One completed CPC (Driver Certificate of Professional Competence)
 * periodic training session, logged by the driver. PERSON-scoped, no
 * `workspaceId` — same reasoning as `DriverDocument` (see
 * decision-2026-08-04-working-time-cpc-training-architecture in the
 * Brain): a driver's training hours follow them across employers, not
 * any one agency. Deliberately minimal — `date` and `hours` are the
 * only required fields, so logging one takes seconds. Plain CRUD, no
 * archive/edit-history machinery like `DriverDocument` — a training
 * record carries no historical-pinning concern of its own (unlike an
 * expiry date, a completed session's hours never need to stay honest
 * against a later correction; a mis-logged one is just deleted). See
 * `cpcTrainingEngine.resolveCpcCycleStatus` for how these roll up into
 * a 35-hour/5-year cycle status, derived from the driver's active
 * `cpc_card` DriverDocument rather than a separately-tracked cycle
 * date.
 * @typedef {Object} CpcTrainingRecord
 * @property {string} id
 * @property {string} personId
 * @property {string} date - "YYYY-MM-DD", the day the session was completed
 * @property {number} hours - typically 7 (one DVSA training day), but any positive value is accepted (half-day/partial modules exist)
 * @property {string|null} provider - optional, e.g. the training company's name; record-keeping only, never validated
 * @property {string|null} notes
 * @property {string} createdAt
 */

export {};
