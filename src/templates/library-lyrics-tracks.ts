import type { Track } from '../editor/types'

// Julia's hand-tuned lyric-video instrument stack, extracted VERBATIM from her
// project 2a617703-3841-47ab-918c-153d193afd89 ('Save your tears lyric video')
// on 2026-07-17 - params, blocks, notes, effects and mover children exactly as
// authored (audio + the Lyrics text track excluded; the template supplies its
// own). Generated file - regenerate from the project rather than hand-editing.
export const LYRIC_TEMPLATE_TRACKS: Track[] = [
  {
    "id": "d0228a2a-79e2-4104-ae38-2861c906129c",
    "name": "Oscilloscope",
    "solo": false,
    "type": "base",
    "color": "#35a7e6",
    "muted": false,
    "onTop": false,
    "blocks": [],
    "params": {
      "lineWidth": 1,
      "transparentBackground": 0
    },
    "effects": [
      {
        "id": "68f08726-5073-424d-abf6-cb6c346ff7d4",
        "enabled": true,
        "pluginId": "kaleidoscope",
        "settings": {
          "zoom": 0.65,
          "hueShift": 0,
          "rotation": 0,
          "segments": 2,
          "spinSpeed": 0.35000000000000003
        }
      },
      {
        "id": "f35c557d-e090-4377-b8b0-a1ef34f02534",
        "enabled": true,
        "pluginId": "opacity",
        "settings": {
          "opacity": 0.51
        }
      }
    ],
    "childIds": [],
    "instrumentId": "oscilloscope",
    "stringParams": {
      "color": "#ff0a0a"
    }
  },
  {
    "id": "87a370a1-cc2d-4d9f-b0df-54f6cc4fd77c",
    "name": "Particle Burst",
    "solo": false,
    "type": "base",
    "color": "#35a7e6",
    "muted": false,
    "onTop": true,
    "blocks": [
      {
        "id": "da2e028a-85b7-4120-9077-a2254b5add36",
        "loop": false,
        "notes": [
          {
            "id": "a2d2351d-fbd1-4916-b7e6-6832ba425917",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 0,
            "durationBeats": 0.25
          },
          {
            "id": "17be0322-b741-4196-906b-b6698bf29c5e",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 2,
            "durationBeats": 0.25
          },
          {
            "id": "24648820-4e42-4036-9d95-82bb88f10cce",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 4,
            "durationBeats": 0.25
          },
          {
            "id": "8bf988b2-cc23-405d-b755-d6b8ae4e6c89",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 6,
            "durationBeats": 0.25
          },
          {
            "id": "b3b1acb6-83e4-45b9-b74d-d2233dba0f88",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 8,
            "durationBeats": 0.25
          },
          {
            "id": "809c5ff9-287d-4486-a90b-a8d0f2130d77",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 10,
            "durationBeats": 0.25
          },
          {
            "id": "03515493-d2ce-42cf-8601-2824ebc12512",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 12,
            "durationBeats": 0.25
          },
          {
            "id": "b6f2a1f7-90ae-4728-affb-63ee9756dc5b",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 14,
            "durationBeats": 0.25
          },
          {
            "id": "6d457d91-8695-420e-80cc-2d07de340f04",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 16,
            "durationBeats": 0.25
          },
          {
            "id": "5ae59c06-0f32-47af-ba94-53d8f981692a",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 18,
            "durationBeats": 0.25
          },
          {
            "id": "64a19ce6-1de5-498d-9418-5c64588f518b",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 20,
            "durationBeats": 0.25
          },
          {
            "id": "08c33cde-fd31-4da7-ba6d-739dc3cd6f35",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 22,
            "durationBeats": 0.25
          },
          {
            "id": "06feaf8f-a9c3-43b6-a565-32f562eb8b28",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 24,
            "durationBeats": 0.25
          },
          {
            "id": "624dbc9c-c9ca-4040-98db-8f66512a184f",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 26,
            "durationBeats": 0.25
          },
          {
            "id": "6a31b4cf-3a3f-4833-8fe4-6846fdd72f51",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 28,
            "durationBeats": 0.25
          },
          {
            "id": "8a7925f4-b969-4809-972f-adacfcd61ea0",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 30,
            "durationBeats": 0.25
          }
        ],
        "startBar": 0,
        "durationBars": 8
      },
      {
        "id": "334fa70d-61b7-460f-bd89-2d8eaa745731",
        "loop": false,
        "notes": [
          {
            "id": "c99726a3-e469-4156-b888-6afdf87355cf",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 0,
            "durationBeats": 0.25
          },
          {
            "id": "2df9560c-d8fd-40bf-be08-1a0a488bc05a",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 2,
            "durationBeats": 0.25
          },
          {
            "id": "4d1ba360-fe62-4e73-a2e8-ca25f434049c",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 4,
            "durationBeats": 0.25
          },
          {
            "id": "4b781ac3-2c95-4d7d-a1c2-0a4c93bce94b",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 6,
            "durationBeats": 0.25
          },
          {
            "id": "06108a2c-8780-489a-a7a8-feee2dc59f42",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 8,
            "durationBeats": 0.25
          },
          {
            "id": "9b9dcb1f-9f55-4a95-94d2-f0615d086fec",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 10,
            "durationBeats": 0.25
          },
          {
            "id": "4c7e5207-4633-4747-9bb3-8e7427c334bc",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 12,
            "durationBeats": 0.25
          },
          {
            "id": "e6cac24a-0b8a-4ba2-88d1-aaccd0fc53c0",
            "pitch": 71,
            "velocity": 100,
            "startBeat": 14,
            "durationBeats": 0.25
          },
          {
            "id": "db527e24-3f27-43be-b0c0-2d6aa902546d",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 16,
            "durationBeats": 0.25
          },
          {
            "id": "c39828a1-2990-454b-9d0f-342bdc1fc898",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 18,
            "durationBeats": 0.25
          },
          {
            "id": "9123d812-6437-44d6-986a-6ed96f0cab7d",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 20,
            "durationBeats": 0.25
          },
          {
            "id": "de8e0dc8-6a27-4387-8921-54aa685f9d1a",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 22,
            "durationBeats": 0.25
          },
          {
            "id": "5d4a8ed8-cb62-4adf-af83-af033f1e0f7c",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 24,
            "durationBeats": 0.25
          },
          {
            "id": "b8d46224-56ac-4ee0-b863-223a924a4ff8",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 26,
            "durationBeats": 0.25
          },
          {
            "id": "4673fd77-e28c-4511-bee5-1f0a480f5d67",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 28,
            "durationBeats": 0.25
          },
          {
            "id": "a4f9d82c-184b-4738-a17e-9211d2787579",
            "pitch": 64,
            "velocity": 100,
            "startBeat": 30,
            "durationBeats": 0.25
          }
        ],
        "startBar": 8,
        "durationBars": 8
      }
    ],
    "params": {
      "count": 7500,
      "pointSize": 0.01,
      "burstCurve": 1,
      "burstPower": 5,
      "burstRadius": 1
    },
    "effects": [
      {
        "id": "9e117657-73a1-4059-98eb-86fb3cb4db53",
        "enabled": true,
        "pluginId": "opacity",
        "settings": {
          "opacity": 0.26
        }
      }
    ],
    "childIds": [
      "5fd6def1-ce8c-4c92-b9d3-65d4c2ea3491",
      "92fa157c-c0d9-4ac4-b83d-1f2ef71ba329"
    ],
    "instrumentId": "particleBurst"
  },
  {
    "id": "5fd6def1-ce8c-4c92-b9d3-65d4c2ea3491",
    "name": "Burst",
    "solo": false,
    "type": "mover",
    "color": "#6366f1",
    "muted": false,
    "blocks": [
      {
        "id": "49890d4a-2db3-4307-9ff4-06dfd55be086",
        "loop": false,
        "notes": [
          {
            "id": "2906f51f-87a2-4ffe-9575-a526497a047c",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 1,
            "durationBeats": 0.25
          },
          {
            "id": "56a9e71d-72ab-4560-9153-2b40a0376b19",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 3,
            "durationBeats": 0.25
          },
          {
            "id": "b30c8efb-39cd-4c8d-9881-a767714548b4",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 5,
            "durationBeats": 0.25
          },
          {
            "id": "f99ffd6e-10f8-44e6-a993-3cb0315ad418",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 7,
            "durationBeats": 0.25
          },
          {
            "id": "9181d60e-f3ac-45d9-8f6e-21b39d4724d6",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 9,
            "durationBeats": 0.25
          },
          {
            "id": "bb06cb16-c980-40ea-98e0-dcbad7280f38",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 11,
            "durationBeats": 0.25
          },
          {
            "id": "67334b7e-7d66-4c31-83c2-f28ee44850a8",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 13,
            "durationBeats": 0.25
          },
          {
            "id": "81cf22dd-26d5-40cb-8872-7a1a4a6890bf",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 17,
            "durationBeats": 0.25
          },
          {
            "id": "0140b2db-e3a9-4e2e-99f9-98386eb98a3c",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 19,
            "durationBeats": 0.25
          },
          {
            "id": "732dff28-944d-49b9-8b26-e106dbfb2e91",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 21,
            "durationBeats": 0.25
          },
          {
            "id": "2ff764aa-46c8-48a0-8184-a1c59223cccd",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 23,
            "durationBeats": 0.25
          },
          {
            "id": "9584f581-1f6a-4997-9517-a8a33aec0e0e",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 25,
            "durationBeats": 0.25
          },
          {
            "id": "82ae5c96-4b7c-4e12-8cd7-837078345be2",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 29,
            "durationBeats": 0.25
          },
          {
            "id": "c20f4051-7eee-4e44-9774-50d1cbe96efc",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 15,
            "durationBeats": 0.25
          },
          {
            "id": "2a1139d8-5107-4bf2-ab6a-396a387c4b4c",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 27,
            "durationBeats": 0.25
          },
          {
            "id": "05a6d926-ff4f-4969-9dcd-0198594e9119",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 31,
            "durationBeats": 0.25
          }
        ],
        "startBar": 0,
        "durationBars": 8
      },
      {
        "id": "2fbec8ab-26d1-4a9f-b3ea-06411b447a6b",
        "loop": false,
        "notes": [
          {
            "id": "f07d2335-26a8-45e4-aab3-f1666c7bf605",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 1,
            "durationBeats": 0.25
          },
          {
            "id": "4aa84afe-45dd-441d-8a63-0482dc9a974b",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 3,
            "durationBeats": 0.25
          },
          {
            "id": "b283b1a1-5943-4a15-9a6d-5a5cfeef3da7",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 5,
            "durationBeats": 0.25
          },
          {
            "id": "68f6d9f0-2794-469b-bef2-72fb38fd1531",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 7,
            "durationBeats": 0.25
          },
          {
            "id": "c76a5a67-a20f-4d29-affb-81cd8638880b",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 9,
            "durationBeats": 0.25
          },
          {
            "id": "5b5834a9-b3e8-43cd-aa2c-5cf3944c1b07",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 11,
            "durationBeats": 0.25
          },
          {
            "id": "9aea77c3-aab5-4e49-98c5-33793b5b66a6",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 13,
            "durationBeats": 0.25
          },
          {
            "id": "f2d0be76-1473-4fd1-bd84-d062b5631333",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 17,
            "durationBeats": 0.25
          },
          {
            "id": "3b194255-744b-4753-84d3-651e0ffd1f7a",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 19,
            "durationBeats": 0.25
          },
          {
            "id": "8d3808eb-caa0-4cde-9935-09df248d4428",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 21,
            "durationBeats": 0.25
          },
          {
            "id": "041be6c6-5b7b-45c6-b507-8e8dddfaea34",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 23,
            "durationBeats": 0.25
          },
          {
            "id": "c2454d7e-c9a0-4904-8991-1f61c91b1868",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 25,
            "durationBeats": 0.25
          },
          {
            "id": "50d517f7-57ac-410a-8c5b-67f75c12e335",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 27,
            "durationBeats": 0.25
          },
          {
            "id": "e4b0b9c5-10df-4393-a6b7-5c215fe7dd2e",
            "pitch": 62,
            "velocity": 100,
            "startBeat": 29,
            "durationBeats": 0.25
          },
          {
            "id": "f6c46637-488e-4a27-bf02-d5958ab92701",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 15,
            "durationBeats": 0.25
          },
          {
            "id": "bcf2176a-3cb0-4613-852e-f5ada33fade6",
            "pitch": 63,
            "velocity": 100,
            "startBeat": 31,
            "durationBeats": 0.25
          }
        ],
        "startBar": 8,
        "durationBars": 8
      }
    ],
    "moverId": "burst",
    "childIds": [],
    "parentId": "87a370a1-cc2d-4d9f-b0df-54f6cc4fd77c",
    "inputValues": {
      "distanceX": 1
    },
    "instrumentId": ""
  },
  {
    "id": "92fa157c-c0d9-4ac4-b83d-1f2ef71ba329",
    "name": "Visibility",
    "solo": false,
    "type": "mover",
    "color": "#6366f1",
    "muted": false,
    "blocks": [
      {
        "id": "aa930586-bd09-47ca-abbb-1f28f23e64d7",
        "loop": true,
        "notes": [
          {
            "id": "ddefbb43-3f04-45a4-b61d-328514730742",
            "pitch": 127,
            "velocity": 100,
            "startBeat": 0,
            "durationBeats": 15
          },
          {
            "id": "257515e2-f5e0-4d57-8b69-40fcd0cbd8ee",
            "pitch": 127,
            "velocity": 100,
            "startBeat": 16,
            "durationBeats": 16
          }
        ],
        "startBar": 0,
        "durationBars": 16,
        "loopLengthBars": 8
      }
    ],
    "moverId": "visibility",
    "childIds": [],
    "parentId": "87a370a1-cc2d-4d9f-b0df-54f6cc4fd77c",
    "inputValues": {},
    "instrumentId": ""
  }
]
