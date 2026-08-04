import { STORAGE_KEYS } from "../storage/keys.js";
import { migration001InitSchema } from "./001_init_schema.js";
import { migration002MigrateLegacyDemoAgency } from "./002_migrate_legacy_demo_agency.js";
import { migration003MigrateLocalStorageToIndexedDb } from "./003_migrate_localstorage_to_indexeddb.js";
import { migration004BackfillRateCardVersioning } from "./004_backfill_rate_card_versioning.js";
import { migration005AddMasterDataFoundation } from "./005_add_master_data_foundation.js";
import { migration006FixEmployerAndClientOrganisations } from "./006_fix_employer_and_client_organisations.js";
import { migration007PersonAndDriverProfileRefinement } from "./007_person_and_driver_profile_refinement.js";
import { migration008EngagementPlacementRefinement } from "./008_engagement_placement_refinement.js";
import { migration009AddVehicleCheckModule } from "./009_add_vehicle_check_module.js";
import { migration010AddPreferredAssignment } from "./010_add_preferred_assignment.js";
import { migration011AddPerLoadPay } from "./011_add_per_load_pay.js";
import { migration012AddDriverDocumentTracking } from "./012_add_driver_document_tracking.js";
import { migration013AddCpcTraining } from "./013_add_cpc_training.js";
import { migration014AddVehicleRoadworthinessFields } from "./014_add_vehicle_roadworthiness_fields.js";

const MIGRATIONS = [
  { version: 1, run: (db) => migration001InitSchema(db) },
  { version: 2, run: (db, storage) => migration002MigrateLegacyDemoAgency(db, storage) },
  { version: 3, run: (db, storage) => migration003MigrateLocalStorageToIndexedDb(db, storage) },
  { version: 4, run: (db) => migration004BackfillRateCardVersioning(db) },
  { version: 5, run: (db) => migration005AddMasterDataFoundation(db) },
  { version: 6, run: (db) => migration006FixEmployerAndClientOrganisations(db) },
  { version: 7, run: (db) => migration007PersonAndDriverProfileRefinement(db) },
  { version: 8, run: (db) => migration008EngagementPlacementRefinement(db) },
  { version: 9, run: (db) => migration009AddVehicleCheckModule(db) },
  { version: 10, run: (db) => migration010AddPreferredAssignment(db) },
  { version: 11, run: (db) => migration011AddPerLoadPay(db) },
  { version: 12, run: (db) => migration012AddDriverDocumentTracking(db) },
  { version: 13, run: (db) => migration013AddCpcTraining(db) },
  { version: 14, run: (db) => migration014AddVehicleRoadworthinessFields(db) },
];

/**
 * Runs any pending migrations in order, version-gated via
 * STORAGE_KEYS.SCHEMA_VERSION so each migration executes at most once
 * — and, since the version is only bumped after a migration's `run()`
 * resolves, a migration that throws partway leaves the version
 * unchanged, so the NEXT boot safely retries it from the top. Every
 * migration here is written to tolerate that retry (upsert-by-id, not
 * strict insert) — see 003 in particular.
 * @param {ReturnType<typeof import('../storage/db.js').createIndexedDbDb>} db
 * @param {Storage} [storage]
 */
export async function runMigrations(db, storage = globalThis.localStorage) {
  let current = Number(storage.getItem(STORAGE_KEYS.SCHEMA_VERSION)) || 0;
  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      await migration.run(db, storage);
      storage.setItem(STORAGE_KEYS.SCHEMA_VERSION, String(migration.version));
      current = migration.version;
    }
  }
}
