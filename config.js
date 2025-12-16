export const config = {
    domainSource: "https://oln-mainapplication-repository.pages.dev",
    // Your WeWeb app preview link
    patterns: [
      // {
      //   pattern: "/event/[^/]+",
      //   metaDataEndpoint: "https://xeo6-2sgh-ehgj.n7.xano.io/api:8wD10mRd/event/{id}/meta"
      // },
      {
        pattern: "/locations/[^/]+",
        metaDataEndpoint: "https://xxgx-bhd0-k4hs.f2.xano.io/api:JyhvLhrj/location/metadata/{id}"
      }
      // Add more patterns and their metadata endpoints as needed
    ]
  };
