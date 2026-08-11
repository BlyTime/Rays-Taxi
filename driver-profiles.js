// Approved driver details. Add another entry here when you approve a new driver.
// These details are copied into a ride only when that driver accepts it.
const DRIVER_PROFILES = {
    "5119CJnu1TbkUof2F8W6YJraSDl1": {
        driverName: "Ray",
        vehicle: "Toyota Ipsum Taxi",
        plate: "",
        licenceStatus: "Verified driver",
        vehicleImage: "taxi-ipsum.png"
    }
};

export function getDriverProfile(driverUid) {
    return DRIVER_PROFILES[driverUid] || {
        driverName: "Ray's Taxi driver",
        vehicle: "Taxi",
        plate: "",
        licenceStatus: "Verified driver",
        vehicleImage: "taxi-ipsum.png"
    };
}
