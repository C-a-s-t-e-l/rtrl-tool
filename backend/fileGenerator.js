const JSZip = require('jszip');
const XLSX = require('xlsx');

const isValidEmail = (email) => {
    return email && typeof email === 'string' && email.includes('@') && email.includes('.');
};

function generateFilename(searchParams, fileSuffix, fileExtension, creationDate = null) {
    const dateObj = creationDate ? new Date(creationDate) : new Date();
    const date = dateObj.toISOString().split('T')[0].replace(/-/g, '');
    const company = 'rtrl';

    let categoryString;
    if (searchParams.customCategory) {
        categoryString = searchParams.customCategory.replace(/[\s/&]/g, "_");
    } else if (searchParams.subCategory === 'multiple_subcategories' && searchParams.subCategoryList && searchParams.subCategoryList.length > 0) {
        categoryString = `${(searchParams.primaryCategory || '').replace(/[\s/&]/g, "_")}_${searchParams.subCategoryList.map(s => s.replace(/[\s/&]/g, "_")).join('_')}`;
    } else if (searchParams.subCategory) {
        categoryString = `${(searchParams.primaryCategory || '').replace(/[\s/&]/g, "_")}_${searchParams.subCategory.replace(/[\s/&]/g, "_")}`;
    } else {
        categoryString = searchParams.primaryCategory?.replace(/[\s/&]/g, "_") || 'businesses';
    }
    
    const locationString = (searchParams.area || 'location').replace(/[\s/,]/g, "_").toLowerCase();

    return `${date}_${company}_${categoryString}_${locationString}_${fileSuffix}.${fileExtension}`;
}

const createLinkObject = (url) => {
    if (!url || typeof url !== 'string' || !url.trim()) return '';
    const formula = `HYPERLINK("${url}", "${url}")`;
    return { f: formula, v: url, t: 's' };
};

async function generateFileData(rawData, searchParams, duplicatesData = [], creationDate = null) {
    rawData.sort((a, b) => (a.BusinessName || '').localeCompare(b.BusinessName || ''));
    if (duplicatesData && duplicatesData.length > 0) {
        duplicatesData.sort((a, b) => (a.BusinessName || '').localeCompare(b.BusinessName || ''));
    }

    const dateObj = creationDate ? new Date(creationDate) : new Date();
    const date = dateObj.toISOString().split('T')[0].replace(/-/g, '');
    let categoryString;
    if (searchParams.customCategory) {
        categoryString = searchParams.customCategory.replace(/[\s/&]/g, "_");
    } else if (searchParams.subCategory === 'multiple_subcategories' && searchParams.subCategoryList && searchParams.subCategoryList.length > 0) {
        categoryString = `${(searchParams.primaryCategory || '').replace(/[\s/&]/g, "_")}_${searchParams.subCategoryList.map(s => s.replace(/[\s/&]/g, "_")).join('_')}`;
    } else if (searchParams.subCategory) {
        categoryString = `${(searchParams.primaryCategory || '').replace(/[\s/&]/g, "_")}_${searchParams.subCategory.replace(/[\s/&]/g, "_")}`;
    } else {
        categoryString = searchParams.primaryCategory?.replace(/[\s/&]/g, "_") || 'general';
    }
    const locationString = (searchParams.area || 'location').replace(/[\s/]/g, "_").toLowerCase();
    const notesContent = `${date}_${categoryString}_${locationString}`;

    const fullData = rawData.map(item => ({
        BusinessName: item.BusinessName,
        Category: item.Category,
        'Suburb/Area': item.Suburb, 
        StreetAddress: item.StreetAddress,
        Website: createLinkObject(item.Website),
        OwnerName: item.OwnerName,
        'Email 1': item.Email1,
        'Email 2': item.Email2,
        'Email 3': item.Email3,
        Phone: item.Phone,
        InstagramURL: createLinkObject(item.InstagramURL),
        FacebookURL: createLinkObject(item.FacebookURL),
        GoogleMapsURL: createLinkObject(item.GoogleMapsURL),
        StarRating: item.StarRating,
        ReviewCount: item.ReviewCount
    }));

    const smsData = rawData
        .filter(b => b.Phone && b.Phone.startsWith("614"))
        .map(b => {
            let firstName = "";
            let lastName = "";
            if (b.OwnerName && b.OwnerName.trim() !== "") {
                const nameParts = b.OwnerName.trim().split(" ");
                firstName = nameParts.shift();
                lastName = nameParts.join(" ");
            }
            return {
                FirstName: firstName,
                LastName: lastName,
                Organization: b.BusinessName || "",
                Email: b.Email1 || "",
                FaxNumber: "",
                MobileNumber: b.Phone || "",
                CustomField1: b.Category || "",
                CustomField2: b.Suburb || "", 
                CustomField3: "",
                CustomField4: "",
                Unsubscribed: ""
            };
        });
    
    const contactsData = rawData
        .filter(d => 
            (isValidEmail(d.Email1) || isValidEmail(d.Email2) || isValidEmail(d.Email3)) 
        )
        .map(d => {
            let state = '';
            if (d.StreetAddress) {
                const stateMatch = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
                state = stateMatch ? stateMatch[1] : '';
            }
            return {
                "Company": d.BusinessName || '',
                "Address_Suburb": d.Suburb || '', 
                "Address_State": state,
                "Notes": notesContent, 
                "Category": d.Category || '', 
                "email_1": d.Email1 || '',
                "email_2": d.Email2 || '',
                "email_3": d.Email3 || '',
                "facebook": d.FacebookURL || '',
                "instagram": d.InstagramURL || '',
                "linkedin": '',
            };
        });
        
    const SPLIT_SIZE = 18;
    let zipBuffer = null;
    let txtZipBuffer = null;

    if (contactsData.length > 0) {
        const zip = new JSZip();
        const txtZip = new JSZip();
        const headers = ["Company", "Address_Suburb", "Address_State", "Notes", "Category", "facebook", "instagram", "linkedin", "email_1", "email_2", "email_3"];

        for (let i = 0; i < contactsData.length; i += SPLIT_SIZE) {
            const chunk = contactsData.slice(i, i + SPLIT_SIZE);
            const splitIndex = Math.floor(i / SPLIT_SIZE) + 1;
            const splitFilename = generateFilename(searchParams, `emails_csv_split_${splitIndex}`, 'csv', creationDate);
            const ws = XLSX.utils.json_to_sheet(chunk, { header: headers });
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, `Contacts Split ${splitIndex}`);
            const csvBuffer = XLSX.write(wb, { bookType: 'csv', type: 'buffer' });
            zip.file(splitFilename, csvBuffer);
        }
        zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

        const emailContacts = contactsData.filter(d => isValidEmail(d.email_1));
        const contactsByCategory = emailContacts.reduce((acc, item) => {
            const category = item.Category || 'Other'; 
            if (!acc[category]) acc[category] = [];
            acc[category].push(item);
            return acc;
        }, {});

        for (const [category, items] of Object.entries(contactsByCategory)) {
            for (let i = 0; i < items.length; i += SPLIT_SIZE) {
                const chunk = items.slice(i, i + SPLIT_SIZE);
                const part = Math.floor(i / SPLIT_SIZE) + 1;
                const emailList = chunk.map(item => item.email_1).join('\n'); 
                const cleanCategory = category.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
                const txtFilename = generateFilename(searchParams, `emails_txt_${cleanCategory}_part_${part}`, 'txt', creationDate);
                txtZip.file(txtFilename, emailList);
            }
        }
        txtZipBuffer = await txtZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }

    const mobileZip = new JSZip();
    const mobilesByCategory = rawData.reduce((acc, item) => {
        if (item.Phone) {
            let num = String(item.Phone).replace(/\D/g, '');
            if (num.startsWith('614')) num = '0' + num.substring(2);
            if (num.startsWith('04')) {
                const cat = item.Category || 'General';
                if (!acc[cat]) acc[cat] = new Set();
                acc[cat].add(num);
            }
        }
        return acc;
    }, {});

    let hasMobiles = false;
    for (const [cat, nums] of Object.entries(mobilesByCategory)) {
        const cleanCat = cat.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').toLowerCase();
        const filename = `${cleanCat}_mobiles.txt`;
        mobileZip.file(filename, Array.from(nums).join('\n'));
        hasMobiles = true;
    }
    const mobileZipBuffer = hasMobiles ? await mobileZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) : null;

    const duplicatesFormattedData = duplicatesData.map(item => ({
        BusinessName: item.BusinessName,
        Category: item.Category,
        'Suburb/Area': item.Suburb, 
        StreetAddress: item.StreetAddress,
        Website: createLinkObject(item.Website),
        OwnerName: item.OwnerName,
        'Email 1': item.Email1,
        'Email 2': item.Email2,
        'Email 3': item.Email3,
        Phone: item.Phone,
        InstagramURL: createLinkObject(item.InstagramURL),
        FacebookURL: createLinkObject(item.FacebookURL),
        GoogleMapsURL: createLinkObject(item.GoogleMapsURL),
        StarRating: item.StarRating,
        ReviewCount: item.ReviewCount
    }));

    return {
        full: {
            data: fullData,
            filename: generateFilename(searchParams, 'Full_No_Duplicates', 'xlsx', creationDate),
            headers: ["BusinessName", "Category", "Suburb/Area", "StreetAddress", "Website", "OwnerName", "Email 1", "Email 2", "Email 3", "Phone", "InstagramURL", "FacebookURL", "GoogleMapsURL", "StarRating", "ReviewCount"]
        },
        sms: {
            data: smsData,
            filename: generateFilename(searchParams, 'Mobile_Numbers_Only', 'csv', creationDate),
            headers: ["FirstName", "LastName", "Organization", "Email", "FaxNumber", "MobileNumber", "CustomField1", "CustomField2", "CustomField3", "CustomField4", "Unsubscribed"]
        },
        contacts: {
            data: contactsData,
            filename: generateFilename(searchParams, 'Full_No_Duplicates_Emails', 'csv', creationDate),
            headers: ["Company", "Address_Suburb", "Address_State", "Notes", "Category", "facebook", "instagram", "linkedin", "email_1", "email_2", "email_3"]
        },
        contactsSplits: {
            data: zipBuffer,
            filename: generateFilename(searchParams, 'emails_csv_splits', 'zip', creationDate) 
        },
        contactsTxtSplits: { 
            data: txtZipBuffer,
            filename: generateFilename(searchParams, 'emails_txt_splits', 'zip', creationDate),
        },
        mobileSplits: {
            data: mobileZipBuffer,
            filename: generateFilename(searchParams, 'mobile_numbers_by_category', 'zip', creationDate)
        },
        duplicates: {
            data: duplicatesFormattedData,
            filename: generateFilename(searchParams, 'duplicates', 'xlsx', creationDate),
            headers: ["BusinessName", "Category", "Suburb/Area", "StreetAddress", "Website", "OwnerName", "Email 1", "Email 2", "Email 3", "Phone", "InstagramURL", "FacebookURL", "GoogleMapsURL", "StarRating", "ReviewCount"]
        }
    };
}

module.exports = { generateFileData, generateFilename };