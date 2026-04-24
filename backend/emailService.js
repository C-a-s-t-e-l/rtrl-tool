const { Resend } = require('resend');
const XLSX = require('xlsx');
const { generateFileData } = require('./fileGenerator');

// Initialize Resend with your API Key from .env
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendResultsByEmail(recipientEmail, rawData, searchParams, duplicatesData = []) {
    if (!recipientEmail) {
        return 'No recipient email provided. Skipping email.';
    }
    if ((!rawData || rawData.length === 0) && (!duplicatesData || duplicatesData.length === 0)) {
        return 'No data to send. Skipping email.';
    }

    console.log(`[Email] Generating files and preparing to send via Resend to ${recipientEmail}...`);

    try {
        const allFiles = await generateFileData(rawData, searchParams, duplicatesData);
        const attachments = [];
        
        // 1. Full XLSX
        if (allFiles.full.data.length > 0) {
            const wsFull = XLSX.utils.json_to_sheet(allFiles.full.data);
            const wbFull = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List (Unique)");
            const excelBuffer = XLSX.write(wbFull, { bookType: 'xlsx', type: 'buffer' });
            attachments.push({
                filename: allFiles.full.filename,
                content: excelBuffer,
            });
        }

        // 2. Duplicates XLSX
        if (allFiles.duplicates && allFiles.duplicates.data.length > 0) {
            const wsDuplicates = XLSX.utils.json_to_sheet(allFiles.duplicates.data);
            const wbDuplicates = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbDuplicates, wsDuplicates, "Duplicates List");
            const excelBuffer = XLSX.write(wbDuplicates, { bookType: 'xlsx', type: 'buffer' });
            attachments.push({
                filename: allFiles.duplicates.filename,
                content: excelBuffer,
            });
        }

        // 3. SMS CSV
        if (allFiles.sms.data.length > 0) {
            const wsSms = XLSX.utils.json_to_sheet(allFiles.sms.data, { header: allFiles.sms.headers });
            const wbSms = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbSms, wsSms, "SMS List");
            const smsCsvBuffer = XLSX.write(wbSms, { bookType: 'csv', type: 'buffer' });
            attachments.push({
                filename: allFiles.sms.filename,
                content: smsCsvBuffer,
            });
        }
        
        // 4. Contacts CSV
        if (allFiles.contacts.data.length > 0) {
            const wsContacts = XLSX.utils.json_to_sheet(allFiles.contacts.data, { header: allFiles.contacts.headers });
            const wbContacts = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbContacts, wsContacts, "Contacts List");
            const contactsCsvBuffer = XLSX.write(wbContacts, { bookType: 'csv', type: 'buffer' });
            attachments.push({
                filename: allFiles.contacts.filename,
                content: contactsCsvBuffer,
            });
        }

        // 5. Zips
        if (allFiles.mobileSplits?.data) {
            attachments.push({ filename: allFiles.mobileSplits.filename, content: allFiles.mobileSplits.data });
        }
        if (allFiles.contactsTxtSplits?.data) {
            attachments.push({ filename: allFiles.contactsTxtSplits.filename, content: allFiles.contactsTxtSplits.data });
        }
        if (allFiles.contactsSplits?.data) {
            attachments.push({ filename: allFiles.contactsSplits.filename, content: allFiles.contactsSplits.data });
        }

        if (attachments.length === 0) {
            return 'No data matched the criteria. No email sent.';
        }

        // Prepare Email Content
        const subCategoryText = (searchParams.subCategoryList && searchParams.subCategoryList.length > 0) 
            ? searchParams.subCategoryList.join(', ') 
            : (searchParams.subCategory || 'N/A');
        
        let locationSummary = searchParams.radiusKm 
            ? `\n- Search Center: ${searchParams.area?.replace(/_/g, ' ') || 'N/A'}\n- Radius: ${searchParams.radiusKm} km`
            : `- Location: ${searchParams.area?.replace(/_/g, ' ') || 'N/A'}`;
        
        const searchSummary = `Search Parameters:\n- Category/Keyword: ${searchParams.customCategory || searchParams.primaryCategory || 'N/A'}\n- Sub-Categories: ${subCategoryText}\n${locationSummary}\n- Country: ${searchParams.country || 'N/A'}`;
        const subjectArea = searchParams.area ? searchParams.area.replace(/_/g, ' ') : 'your selected area';
        const subjectCategory = searchParams.customCategory || searchParams.primaryCategory || 'Businesses';

        // SEND VIA RESEND
        const { data, error } = await resend.emails.send({
            from: 'RTRL Prospector <reports@backend.rtrlprospector.space>',
            to: recipientEmail,
            subject: `${searchParams.subjectPrefix || ''}Your RTRL Results: ${subjectCategory} in ${subjectArea}`,
            text: `Hi,\n\n${searchParams.bodyPrefix || 'Please find the results of your recent search attached.'}\n\n${searchSummary}\n\n- The RTRL Property Prospector Team`,
            attachments: attachments,
        });

        if (error) throw error;

        console.log(`[Email] Successfully sent results to ${recipientEmail} (ID: ${data.id})`);
        return `Successfully sent results to ${recipientEmail}`;
    } catch (error) {
        console.error(`[Email] Failed to send email via Resend:`, error);
        return `Failed to send email: ${error.message}`;
    }
}

async function sendAdminStatsSummary(jobId, rawData, searchParams) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail || !process.env.RESEND_API_KEY) return;

    const userEmail = (searchParams.userEmail || "").toLowerCase().trim();
    const excludeList = (process.env.ADMIN_SUMMARY_EXCLUDE_LIST || "").toLowerCase().split(',').map(e => e.trim());
    if (excludeList.includes(userEmail)) return;

    const total = rawData.length;
    if (total === 0) return;

    let mobiles = 0, landlines = 0, realEmails = 0, genericEmails = 0;
    const genericPrefixes = ['info', 'admin', 'hello', 'contact', 'sales', 'reception', 'enquiries', 'support', 'office', 'mail'];

    rawData.forEach(item => {
        const phone = String(item.Phone || "");
        if (phone.startsWith('614')) mobiles++; else if (phone.length > 5) landlines++;
        const email = (item.Email1 || "").toLowerCase().trim();
        if (email && email.includes('@')) {
            const prefix = email.split('@')[0];
            if (genericPrefixes.some(p => prefix === p || prefix.startsWith(p + "."))) genericEmails++; else realEmails++;
        }
    });

    const statsText = `RTRL ADMIN SUMMARY\nJob ID: ${jobId}\nSearch: ${searchParams.customCategory || searchParams.primaryCategory} in ${searchParams.area}\nUser: ${userEmail}\n\n- Total: ${total}\n- Mobiles: ${mobiles}\n- Real Emails: ${realEmails}`;

    try {
        await resend.emails.send({
            from: 'RTRL Stats <reports@backend.rtrlprospector.space>',
            to: adminEmail,
            subject: `STATS: ${total} leads - ${searchParams.area}`,
            text: statsText,
        });
    } catch (error) {
        console.error(`[Admin Stats] Failed:`, error);
    }
}

module.exports = { sendResultsByEmail, sendAdminStatsSummary };