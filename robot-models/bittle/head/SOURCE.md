# Bittle head and neck

`head__1.stl`, `jaw_1.stl`, `c_neck__1.stl` and `servo_neck__1.stl` are unmodified meshes from Petoi's official Bittle model:
https://github.com/PetoiCamp/ros_opencat/tree/main/petoi_ROS_model_docs/bittle_ros/bittle_description (MIT license, see `LICENSE`).

They are in millimetres in that model's frame (x forward, y left, z up). `../bittle.urdf` places them with a 90° yaw and a
translation fitted to the four shoulder hinges. Petoi's model has the head turned 39.65° to the right at zero;
the URDF turns it back so that neck angle 0 faces straight ahead (left-right symmetric within 0.9 mm). The head turns about Petoi's neck axis (tilted 30° forward) on `neck-joint`,
which maps to OpenCat servo 0.
