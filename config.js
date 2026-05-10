export const config = {
    domainSource: "https://32c40fd2-9294-4e8d-b573-38afaf6cd060.weweb-preview.io",
    // Your WeWeb app preview link
    patterns: [
      // {
      //   pattern: "/event/[^/]+",
      //   metaDataEndpoint: "https://xeo6-2sgh-ehgj.n7.xano.io/api:8wD10mRd/event/{id}/meta"
      // },
      {
        pattern: "/(en|de|es|fr|pt|it|ja|pl)/locations/[^/]+",
        metaDataEndpoint: "https://xxgx-bhd0-k4hs.f2.xano.io/api:JyhvLhrj/location/metadata/{id}/{language_code}"
      }
      // Add more patterns and their metadata endpoints as needed
    ]
  };
