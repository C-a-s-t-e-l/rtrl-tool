function generateFilename(searchParams, fileSuffix, fileExtension) {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const company = 'rtrl';

    let categoryString;
    if (searchParams.customCategory) {
        categoryString = searchParams.customCategory.replace(/[\s/&]/g, "_");
    } else if (searchParams.subCategory === 'multiple_subcategories' && searchParams.subCategoryList && searchParams.subCategoryList.length > 0) {
 
        categoryString = `${searchParams.primaryCategory.replace(/[\s/&]/g, "_")}_${searchParams.subCategoryList.map(s => s.replace(/[\s/&]/g, "_")).join('_')}`;
    } else if (searchParams.subCategory) {
        categoryString = `${searchParams.primaryCategory.replace(/[\s/&]/g, "_")}_${searchParams.subCategory.replace(/[\s/&]/g, "_")}`;
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

function generateFileData(rawData, searchParams) {

    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    let categoryString;
    if (searchParams.customCategory) {
        categoryString = searchParams.customCategory.replace(/[\s/&]/g, "_");
    } else if (searchParams.subCategory === 'multiple_subcategories' && searchParams.subCategoryList && searchParams.subCategoryList.length > 0) {
        categoryString = `${searchParams.primaryCategory.replace(/[\s/&]/g, "_")}_${searchParams.subCategoryList.map(s => s.replace(/[\s/&]/g, "_")).join('_')}`;
    } else if (searchParams.subCategory) {
        categoryString = `${searchParams.primaryCategory.replace(/[\s/&]/g, "_")}_${searchParams.subCategory.replace(/[\s/&]/g, "_")}`;
    } else {
        categoryString = searchParams.primaryCategory?.replace(/[\s/&]/g, "_") || 'general';
    }
    const locationString = (searchParams.area || 'location').replace(/[\s/]/g, "_").toLowerCase();
    const notesContent = `${date}_${categoryString}_${locationString}`;

    const fullData = rawData.map(item => ({
        BusinessName: item.BusinessName,
        Category: item.Category,
        'Suburb/Area': item.SuburbArea,
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
                CustomField2: b.SuburbArea || "",
                CustomField3: "",
                CustomField4: "",
                Unsubscribed: ""
            };
        });
    
    const contactsData = rawData
        .filter(d => (d.Email1 && d.Email1.trim() !== "") || (d.Email2 && d.Email2.trim() !== ""))
        .map(d => {
            let state = '';
            if (d.StreetAddress) {
                const stateMatch = d.StreetAddress.match(/\b([A-Z]{2,3})\b(?= \d{4,})/);
                state = stateMatch ? stateMatch[1] : '';
            }
            return {
                "Company": d.BusinessName || '',
                "Address_(other)_Sub": d.SuburbArea || '',
                "Address_(other)_State": state,
                "Notes": notesContent, 
                "facebook": d.FacebookURL || '',
                "instagram": d.InstagramURL || '',
                "linkedin": '',
                "email_1": d.Email1 || '',
                "email_2": d.Email2 || '',
                "email_3": d.Email3 || ''
            };
        });

    return {
        full: {
            data: fullData,
            filename: generateFilename(searchParams, 'full', 'xlsx'),
            headers: ["BusinessName", "Category", "Suburb/Area", "StreetAddress", "Website", "OwnerName", "Email 1", "Email 2", "Email 3", "Phone", "InstagramURL", "FacebookURL", "GoogleMapsURL", "StarRating", "ReviewCount"]
        },
        sms: {
            data: smsData,
            filename: generateFilename(searchParams, 'sms', 'csv'),
            headers: ["FirstName", "LastName", "Organization", "Email", "FaxNumber", "MobileNumber", "CustomField1", "CustomField2", "CustomField3", "CustomField4", "Unsubscribed"]
        },
        contacts: {
            data: contactsData,
            filename: generateFilename(searchParams, 'emails', 'csv'),
            headers: ["Company", "Address_(other)_Sub", "Address_(other)_State", "Notes", "facebook", "instagram", "linkedin", "email_1", "email_2", "email_3"]
        }
    };
}

module.exports = { generateFileData };