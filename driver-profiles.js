// The first time Reis opens the dashboard, this becomes /drivers/ray/profile
// in Firebase. Later, a protected profile-editing page can update that record.
const DEFAULT_PROFILE = {
    driverName: "Reis Yaw",
    vehicle: "Toyota Ipsum",
    plate: "PAN 3873",
    licenceStatus: "Verified driver",
    photo: "reis-yaw-driver.png"
};

export function getDefaultDriverProfile(driverUid) {
    return { ...DEFAULT_PROFILE, driverUid };
}

export function normaliseDriverProfile(profile, driverUid) {
    return { ...getDefaultDriverProfile(driverUid), ...(profile || {}), driverUid };
}
