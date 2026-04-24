const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const { generateFileData } = require('./fileGenerator');

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        // This helps if the cloud network has strict handshake rules
        rejectUnauthorized: false 
    },
    connectionTimeout: 20000, // Increase to 20s
});

async function sendResultsByEmail(recipientEmail, rawData, searchParams, duplicatesData = []) {
    if (!recipientEmail) {
        return 'No recipient email provided. Skipping email.';
    }
    if ((!rawData || rawData.length === 0) && (!duplicatesData || duplicatesData.length === 0)) {
        return 'No data to send. Skipping email.';
    }

    console.log(`[Email] Generating files and preparing to send results to ${recipientEmail}...`);

    try {
        const allFiles = await generateFileData(rawData, searchParams, duplicatesData);

        const attachments = [];
        
        if (allFiles.full.data.length > 0) {
            const wsFull = XLSX.utils.json_to_sheet(allFiles.full.data);
            const wbFull = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List (Unique)");
            const excelBuffer = XLSX.write(wbFull, { bookType: 'xlsx', type: 'buffer' });
            attachments.push({
                filename: allFiles.full.filename,
                content: excelBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
        }

        if (allFiles.duplicates && allFiles.duplicates.data.length > 0) {
            const wsDuplicates = XLSX.utils.json_to_sheet(allFiles.duplicates.data);
            const wbDuplicates = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbDuplicates, wsDuplicates, "Duplicates List");
            const excelBuffer = XLSX.write(wbDuplicates, { bookType: 'xlsx', type: 'buffer' });
            attachments.push({
                filename: allFiles.duplicates.filename,
                content: excelBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
        }

        if (allFiles.sms.data.length > 0) {
            const wsSms = XLSX.utils.json_to_sheet(allFiles.sms.data, { header: allFiles.sms.headers });
            const wbSms = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbSms, wsSms, "SMS List");
            const smsCsvBuffer = XLSX.write(wbSms, { bookType: 'csv', type: 'buffer' });
            attachments.push({
                filename: allFiles.sms.filename,
                content: smsCsvBuffer,
                contentType: 'text/csv',
            });
        }
        
        if (allFiles.contacts.data.length > 0) {
            const wsContacts = XLSX.utils.json_to_sheet(allFiles.contacts.data, { header: allFiles.contacts.headers });
            const wbContacts = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbContacts, wsContacts, "Contacts List");
            const contactsCsvBuffer = XLSX.write(wbContacts, { bookType: 'csv', type: 'buffer' });
            attachments.push({
                filename: allFiles.contacts.filename,
                content: contactsCsvBuffer,
                contentType: 'text/csv',
            });
        }

        if (allFiles.mobileSplits && allFiles.mobileSplits.data) {
            attachments.push({
                filename: allFiles.mobileSplits.filename,
                content: allFiles.mobileSplits.data,
                contentType: 'application/zip',
            });
        }
        
        if (allFiles.contactsTxtSplits && allFiles.contactsTxtSplits.data) {
            attachments.push({
                filename: allFiles.contactsTxtSplits.filename,
                content: allFiles.contactsTxtSplits.data,
                contentType: 'application/zip',
            });
        }
        
        if (allFiles.contactsSplits.data) {
            attachments.push({
                filename: allFiles.contactsSplits.filename,
                content: allFiles.contactsSplits.data,
                contentType: 'application/zip',
            });
        }

        if (attachments.length === 0) {
            return 'No data matched the criteria for any file type. No email sent.';
        }

        const subCategoryText = (searchParams.subCategoryList && searchParams.subCategoryList.length > 0) 
            ? searchParams.subCategoryList.join(', ') 
            : (searchParams.subCategory || 'N/A');
        
        let locationSummary;
        if (searchParams.radiusKm) {
            locationSummary = `
- Search Center: ${searchParams.area ? searchParams.area.replace(/_/g, ' ') : 'N/A'}
- Radius: ${searchParams.radiusKm} km`;
        } else {
            locationSummary = `- Location: ${searchParams.area ? searchParams.area.replace(/_/g, ' ') : 'N/A'}`;
        }
        
        const searchSummary = `
Search Parameters:
- Category/Keyword: ${searchParams.customCategory || searchParams.primaryCategory || 'N/A'}
- Sub-Categories: ${subCategoryText}
${locationSummary}
- Country: ${searchParams.country || 'N/A'}
        `;

        const subjectPrefix = searchParams.subjectPrefix || '';
        const bodyPrefix = searchParams.bodyPrefix || 'Please find the results of your recent search attached.\n';
        const subjectArea = searchParams.area ? searchParams.area.replace(/_/g, ' ') : 'your selected area';
        const subjectCategory = searchParams.customCategory || searchParams.primaryCategory || 'Businesses';

        const mailOptions = {
            from: `"RTRL Prospector" <${process.env.EMAIL_USER}>`,
            to: recipientEmail,
            subject: `${subjectPrefix}Your RTRL Prospector Results: ${subjectCategory} in ${subjectArea}`,
            text: `Hi,\n\n${bodyPrefix}\n${searchSummary}\n- The RTRL Property Prospector Team`,
            attachments: attachments,
        };

        await transporter.sendMail(mailOptions);
        console.log(`[Email] Successfully sent results to ${recipientEmail}`);
        return `Successfully sent results to ${recipientEmail}`;
    } catch (error) {
        console.error(`[Email] Failed to send email to ${recipientEmail}:`, error);
        return `Failed to send email: ${error.message}`;
    }
}

async function sendAdminStatsSummary(jobId, rawData, searchParams) {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) return;

    const excludeList = (process.env.ADMIN_SUMMARY_EXCLUDE_LIST || "").toLowerCase().split(',').map(e => e.trim());
    const userEmail = (searchParams.userEmail || "").toLowerCase().trim();
    if (excludeList.includes(userEmail)) {
        return;
    }

    const total = rawData.length;
    if (total === 0) return;

    let mobiles = 0;
    let landlines = 0;
    let genericEmails = 0;
    let realEmails = 0;
    const genericPrefixes = ['info', 'admin', 'hello', 'contact', 'sales', 'reception', 'enquiries', 'support', 'office', 'mail'];

    rawData.forEach(item => {
        const phone = String(item.Phone || "");
        if (phone.startsWith('614')) {
            mobiles++;
        } else if (phone.length > 5) {
            landlines++;
        }

        const email = (item.Email1 || "").toLowerCase().trim();
        if (email && email.includes('@')) {
            const prefix = email.split('@')[0];
            const isGeneric = genericPrefixes.some(p => prefix === p || prefix.startsWith(p + "."));
            if (isGeneric) {
                genericEmails++;
            } else {
                realEmails++;
            }
        }
    });

    const statsText = `
RTRL ADMIN SUMMARY
-----------------------------------------
Job ID: ${jobId}
Search: ${searchParams.customCategory || searchParams.primaryCategory} in ${searchParams.area}
User Email: ${userEmail}

Numbers and percentages relative to total businesses:
- Total businesses: ${total}
- Landlines percentage: ${((landlines / total) * 100).toFixed(1)}% (${landlines})
- Mobile percentage: ${((mobiles / total) * 100).toFixed(1)}% (${mobiles})
- Real Emails percentage: ${((realEmails / total) * 100).toFixed(1)}% (${realEmails})
- Generic Emails percentage: ${((genericEmails / total) * 100).toFixed(1)}% (${genericEmails})
-----------------------------------------
    `.trim();

    try {
        await transporter.sendMail({
            from: `"RTRL Stats" <${process.env.EMAIL_USER}>`,
            to: adminEmail,
            subject: `STATS: ${total} leads - ${searchParams.area}`,
            text: statsText,
        });
        console.log(`[Admin Stats] Summary sent for job ${jobId}`);
    } catch (error) {
        console.error(`[Admin Stats] Failed to send:`, error);
    }
}

module.exports = { sendResultsByEmail, sendAdminStatsSummary };