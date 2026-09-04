dataset_info = {
    "dataset_name": "tcger-card-corners",
    "paper_info": {},
    "keypoint_info": {
        0: {
            "name": "top_left",
            "id": 0,
            "color": [0, 255, 0],
            "type": "",
            "swap": "top_right",
        },
        1: {
            "name": "top_right",
            "id": 1,
            "color": [0, 255, 0],
            "type": "",
            "swap": "top_left",
        },
        2: {
            "name": "bottom_right",
            "id": 2,
            "color": [0, 255, 0],
            "type": "",
            "swap": "bottom_left",
        },
        3: {
            "name": "bottom_left",
            "id": 3,
            "color": [0, 255, 0],
            "type": "",
            "swap": "bottom_right",
        },
    },
    "skeleton_info": {
        0: {"link": ("top_left", "top_right"), "id": 0, "color": [0, 255, 0]},
        1: {"link": ("top_right", "bottom_right"), "id": 1, "color": [0, 255, 0]},
        2: {"link": ("bottom_right", "bottom_left"), "id": 2, "color": [0, 255, 0]},
        3: {"link": ("bottom_left", "top_left"), "id": 3, "color": [0, 255, 0]},
    },
    "joint_weights": [1.0, 1.0, 1.0, 1.0],
    "sigmas": [0.025, 0.025, 0.025, 0.025],
}
