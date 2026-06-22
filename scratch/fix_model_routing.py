import os

file_path = '/home/tanvir/Desktop/gsttool_project/gst-recon-saas/services/upload-service/src/models/normalizedGstr2bModel.js'

with open(file_path, 'r') as f:
    content = f.read()

# Target block 1 (listInvoices)
target1 = """        if (importType) {
            conditions.push('import_type = ?');
            params.push(importType.toUpperCase());
        }"""

replacement1 = """        // Strictly enforce import_type filtering to avoid cross-contamination in v_gstr_listing
        const finalImportType = (importType || 'GSTR2B').toUpperCase();
        conditions.push('import_type = ?');
        params.push(finalImportType);

        console.log(`[NormalizedGstr2bModel.listInvoices] Querying v_gstr_listing with Type: ${finalImportType}`);"""

# Target block 2 (getListingSummary)
target2 = """        if (importType) {
            conditions.push('import_type = ?');
            params.push(importType.toUpperCase());
        }"""

# Note: The target is likely the same string. I'll replace all occurrences if they match.
# But I should be careful.

new_content = content.replace(target1, replacement1)

if new_content == content:
    print("Failed to replace Target 1. Checking for variants...")
    # Try with different indentation or line ends if needed, but the above is literal.
else:
    print("Successfully replaced Target 1.")

with open(file_path, 'w') as f:
    f.write(new_content)

print("Finished update.")
