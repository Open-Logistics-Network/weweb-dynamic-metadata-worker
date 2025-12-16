export const config = {
  domainSource: "https://www.openlogistics.network", // Your WeWeb app preview link
  patterns: [
      {
          pattern: "/locations/[^/]+",
          metaDataEndpoint: "https://xeo6-2sgh-ehgj.n7.xano.io/api:8wD10mRd/locations/{id}"
      },
      {
          pattern: "/location/metadata/[^/]+",
          metaDataEndpoint: "https://xxgx-bhd0-k4hs.f2.xano.io/api:JyhvLhrj/location/metadata/{internal_location_id}"
      }
      // Add more patterns and their metadata endpoints as needed
  ]
};
