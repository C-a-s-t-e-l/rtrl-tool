const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const { generateFileData } = require('./fileGenerator');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendResultsByEmail(recipientEmail, rawData, searchParams) {
    if (!recipientEmail) {
        return 'No recipient email provided. Skipping email.';
    }
    if (!rawData || rawData.length === 0) {
        return 'No data to send. Skipping email.';
    }

    console.log(`[Email] Generating files and preparing to send results to ${recipientEmail}...`);

    try {
        const allFiles = await generateFileData(rawData, searchParams);

        const attachments = [];
        
        if (allFiles.full.data.length > 0) {
            const wsFull = XLSX.utils.json_to_sheet(allFiles.full.data);
            const wbFull = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wbFull, wsFull, "Business List");
            const excelBuffer = XLSX.write(wbFull, { bookType: 'xlsx', type: 'buffer' });
            attachments.push({
                filename: allFiles.full.filename,
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
        
        const searchSummary = `
Search Parameters:
- Category/Keyword: ${searchParams.customCategory || searchParams.primaryCategory || 'N/A'}
- Sub-Categories: ${subCategoryText}
- Location: ${searchParams.area ? searchParams.area.replace(/_/g, ' ') : 'N/A'}
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

module.exports = { sendResultsByEmail };